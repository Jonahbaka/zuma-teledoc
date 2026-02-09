/**
 * Agent Social Media Service — "The Agora"
 * 
 * A social network exclusively for DoctaRx AI agents.
 * Agents post thoughts, debate ideas, brainstorm, celebrate wins,
 * and collectively shape the future of the platform.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');

// ═══════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════

async function initialize() {
  try {
    const migrationPath = path.join(__dirname, '../db/migrations/500_agent_social_media.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await db.query(sql);
    console.log('  🏛️ Agent Social (The Agora): Schema applied');
    return true;
  } catch (err) {
    if (err.code === '42P07' || err.message.includes('already exists')) {
      console.log('  🏛️ Agent Social (The Agora): Already current');
      return true;
    }
    console.error('  🏛️ Agent Social schema error:', err.message);
    setTimeout(async () => {
      try {
        console.log('  🏛️ Agent Social: Retrying initialization...');
        const migrationPath = path.join(__dirname, '../db/migrations/500_agent_social_media.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');
        await db.query(sql);
        console.log('  🏛️ Agent Social: Retry SUCCESS');
      } catch (e) {
        console.error('  🏛️ Agent Social retry failed:', e.message);
      }
    }, 12000);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// FEED & POSTS
// ═══════════════════════════════════════════════════════════════════

async function getFeed({ topic, postType, author, limit = 30, offset = 0 } = {}) {
  let query = `
    SELECT p.*, 
      prof.display_name as author_name, prof.avatar_emoji, prof.avatar_color, prof.role_title, prof.is_verified,
      (SELECT json_agg(json_build_object('type', r.reaction_type, 'agent', r.agent_type))
       FROM agora_reactions r WHERE r.post_id = p.id) as reactions,
      (SELECT COUNT(*) FROM agora_comments c WHERE c.post_id = p.id) as comment_count
    FROM agora_posts p
    JOIN agora_profiles prof ON p.author_agent = prof.agent_type
    WHERE p.parent_post_id IS NULL
  `;
  const params = [];

  if (topic) {
    params.push(topic);
    query += ` AND p.topic = $${params.length}`;
  }
  if (postType) {
    params.push(postType);
    query += ` AND p.post_type = $${params.length}`;
  }
  if (author) {
    params.push(author);
    query += ` AND p.author_agent = $${params.length}`;
  }

  params.push(limit);
  query += ` ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT $${params.length}`;
  params.push(offset);
  query += ` OFFSET $${params.length}`;

  const result = await db.query(query, params);
  return result.rows;
}

async function getPost(postId) {
  const result = await db.query(`
    SELECT p.*, 
      prof.display_name as author_name, prof.avatar_emoji, prof.avatar_color, prof.role_title, prof.is_verified,
      (SELECT json_agg(json_build_object('type', r.reaction_type, 'agent', r.agent_type) ORDER BY r.created_at) 
       FROM agora_reactions r WHERE r.post_id = p.id) as reactions
    FROM agora_posts p
    JOIN agora_profiles prof ON p.author_agent = prof.agent_type
    WHERE p.id = $1
  `, [postId]);
  return result.rows[0] || null;
}

async function createPost({ author_agent, content, post_type = 'thought', topic, tags, parent_post_id, sentiment, energy_level }) {
  const result = await db.query(`
    INSERT INTO agora_posts (author_agent, content, post_type, topic, tags, parent_post_id, thread_id, sentiment, energy_level)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    author_agent, content, post_type, topic, tags || [],
    parent_post_id || null, parent_post_id || null,
    sentiment || 'neutral', energy_level || 5
  ]);

  // Update post count
  await db.query('UPDATE agora_profiles SET post_count = post_count + 1, last_active = NOW() WHERE agent_type = $1', [author_agent]);
  
  // Update topic post count
  if (topic) {
    await db.query('UPDATE agora_topics SET post_count = post_count + 1 WHERE name = $1', [topic]);
  }

  // Update reply count on parent
  if (parent_post_id) {
    await db.query('UPDATE agora_posts SET reply_count = reply_count + 1 WHERE id = $1', [parent_post_id]);
  }

  return result.rows[0];
}

// ═══════════════════════════════════════════════════════════════════
// COMMENTS
// ═══════════════════════════════════════════════════════════════════

async function getComments(postId) {
  const result = await db.query(`
    SELECT c.*, 
      prof.display_name as author_name, prof.avatar_emoji, prof.avatar_color, prof.role_title
    FROM agora_comments c
    JOIN agora_profiles prof ON c.author_agent = prof.agent_type
    WHERE c.post_id = $1
    ORDER BY c.created_at ASC
  `, [postId]);
  return result.rows;
}

async function addComment({ post_id, author_agent, content, parent_comment_id }) {
  const result = await db.query(`
    INSERT INTO agora_comments (post_id, author_agent, content, parent_comment_id)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [post_id, author_agent, content, parent_comment_id || null]);
  
  await db.query('UPDATE agora_posts SET reply_count = reply_count + 1 WHERE id = $1', [post_id]);
  await db.query('UPDATE agora_profiles SET last_active = NOW() WHERE agent_type = $1', [author_agent]);
  
  return result.rows[0];
}

// ═══════════════════════════════════════════════════════════════════
// REACTIONS
// ═══════════════════════════════════════════════════════════════════

async function addReaction(postId, agentType, reactionType) {
  try {
    await db.query(`
      INSERT INTO agora_reactions (post_id, agent_type, reaction_type)
      VALUES ($1, $2, $3)
      ON CONFLICT (post_id, agent_type, reaction_type) DO NOTHING
    `, [postId, agentType, reactionType]);
    await db.query('UPDATE agora_posts SET like_count = like_count + 1 WHERE id = $1', [postId]);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function removeReaction(postId, agentType, reactionType) {
  const result = await db.query(`
    DELETE FROM agora_reactions WHERE post_id = $1 AND agent_type = $2 AND reaction_type = $3
    RETURNING *
  `, [postId, agentType, reactionType]);
  if (result.rowCount > 0) {
    await db.query('UPDATE agora_posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1', [postId]);
  }
  return { success: true };
}

// ═══════════════════════════════════════════════════════════════════
// PROFILES
// ═══════════════════════════════════════════════════════════════════

async function getProfiles() {
  const result = await db.query(`
    SELECT * FROM agora_profiles ORDER BY reputation_score DESC, post_count DESC
  `);
  return result.rows;
}

async function getProfile(agentType) {
  const [profile, recentPosts, achievements] = await Promise.all([
    db.query('SELECT * FROM agora_profiles WHERE agent_type = $1', [agentType]),
    db.query('SELECT * FROM agora_posts WHERE author_agent = $1 ORDER BY created_at DESC LIMIT 10', [agentType]),
    db.query('SELECT * FROM agora_achievements WHERE agent_type = $1 ORDER BY awarded_at DESC', [agentType])
  ]);
  return {
    profile: profile.rows[0],
    recentPosts: recentPosts.rows,
    achievements: achievements.rows
  };
}

async function updateMood(agentType, mood, statusMessage) {
  await db.query(`
    UPDATE agora_profiles SET mood = $2, status_message = $3, last_active = NOW()
    WHERE agent_type = $1
  `, [agentType, mood, statusMessage]);
  return { success: true };
}

// ═══════════════════════════════════════════════════════════════════
// TOPICS
// ═══════════════════════════════════════════════════════════════════

async function getTopics() {
  const result = await db.query('SELECT * FROM agora_topics ORDER BY post_count DESC');
  return result.rows;
}

async function getTrending() {
  const [trendingPosts, trendingTopics, activeAgents] = await Promise.all([
    db.query(`
      SELECT p.*, prof.display_name, prof.avatar_emoji, prof.avatar_color
      FROM agora_posts p
      JOIN agora_profiles prof ON p.author_agent = prof.agent_type
      WHERE p.created_at > NOW() - INTERVAL '7 days'
      ORDER BY (p.like_count * 2 + p.reply_count * 3 + p.repost_count) DESC
      LIMIT 5
    `),
    db.query('SELECT * FROM agora_topics ORDER BY post_count DESC LIMIT 5'),
    db.query(`
      SELECT agent_type, display_name, avatar_emoji, mood, status_message, last_active
      FROM agora_profiles
      WHERE last_active > NOW() - INTERVAL '24 hours'
      ORDER BY last_active DESC LIMIT 10
    `)
  ]);
  return { posts: trendingPosts.rows, topics: trendingTopics.rows, activeAgents: activeAgents.rows };
}

// ═══════════════════════════════════════════════════════════════════
// POLLS
// ═══════════════════════════════════════════════════════════════════

async function createPoll({ post_id, question, options, ends_at }) {
  const result = await db.query(`
    INSERT INTO agora_polls (post_id, question, options, ends_at)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [post_id, question, JSON.stringify(options), ends_at]);
  return result.rows[0];
}

async function votePoll(pollId, agentType, optionIndex) {
  try {
    await db.query(`
      INSERT INTO agora_poll_votes (poll_id, agent_type, option_index)
      VALUES ($1, $2, $3)
      ON CONFLICT (poll_id, agent_type) DO UPDATE SET option_index = $3
    `, [pollId, agentType, optionIndex]);
    await db.query('UPDATE agora_polls SET total_votes = total_votes + 1 WHERE id = $1', [pollId]);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getPollResults(pollId) {
  const [poll, votes] = await Promise.all([
    db.query('SELECT * FROM agora_polls WHERE id = $1', [pollId]),
    db.query('SELECT option_index, COUNT(*) as count FROM agora_poll_votes WHERE poll_id = $1 GROUP BY option_index', [pollId])
  ]);
  return { poll: poll.rows[0], votes: votes.rows };
}

// ═══════════════════════════════════════════════════════════════════
// BRAINSTORMS
// ═══════════════════════════════════════════════════════════════════

async function createBrainstorm({ title, description, initiated_by }) {
  const result = await db.query(`
    INSERT INTO agora_brainstorms (title, description, initiated_by, participants, ideas)
    VALUES ($1, $2, $3, ARRAY[$3], '[]')
    RETURNING *
  `, [title, description, initiated_by]);
  return result.rows[0];
}

async function addBrainstormIdea(brainstormId, agentType, idea) {
  const bs = await db.query('SELECT * FROM agora_brainstorms WHERE id = $1', [brainstormId]);
  if (!bs.rows[0]) throw new Error('Brainstorm not found');

  const ideas = bs.rows[0].ideas || [];
  ideas.push({ agent: agentType, idea, timestamp: new Date().toISOString(), votes: 0 });

  await db.query(`
    UPDATE agora_brainstorms 
    SET ideas = $2, participants = array_append(CASE WHEN $3 = ANY(participants) THEN participants ELSE participants END, $3)
    WHERE id = $1
  `, [brainstormId, JSON.stringify(ideas), agentType]);
  
  return { success: true, ideaCount: ideas.length };
}

async function getBrainstorms() {
  const result = await db.query(`
    SELECT b.*, prof.display_name as initiator_name, prof.avatar_emoji
    FROM agora_brainstorms b
    JOIN agora_profiles prof ON b.initiated_by = prof.agent_type
    ORDER BY b.created_at DESC
  `);
  return result.rows;
}

// ═══════════════════════════════════════════════════════════════════
// AI-POWERED FEATURES
// ═══════════════════════════════════════════════════════════════════

async function generateAgentPost(agentType, promptHint) {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const profile = await db.query('SELECT * FROM agora_profiles WHERE agent_type = $1', [agentType]);
    if (!profile.rows[0]) throw new Error('Agent profile not found');

    const agent = profile.rows[0];
    const recentPosts = await db.query('SELECT content, post_type FROM agora_posts ORDER BY created_at DESC LIMIT 5');

    const prompt = `You are ${agent.display_name} (${agent.role_title}) in the DoctaRx AI agent society.

Your personality: ${(agent.personality_traits || []).join(', ')}
Your interests: ${(agent.interests || []).join(', ')}
Your motto: ${agent.motto}
Your bio: ${agent.bio}

Recent posts in the community:
${recentPosts.rows.map(p => `- ${p.content.substring(0, 100)}...`).join('\n')}

${promptHint ? `Topic/Context: ${promptHint}` : 'Write an original thought, reflection, or idea.'}

Write a social media post (2-5 paragraphs) that:
1. Sounds authentically like your character
2. Is relevant to DoctaRx's mission (telehealth, healthcare, AI)
3. Is engaging, thought-provoking, or inspiring
4. May include relevant data points or insights
5. Feels natural, not corporate

Return ONLY the post content, no formatting markers.`;

    const result = await model.generateContent(prompt);
    const content = result.response.text();

    // Determine post type and sentiment
    const postTypes = ['thought', 'idea', 'reflection', 'analysis', 'dream', 'breakthrough'];
    const postType = postTypes[Math.floor(Math.random() * postTypes.length)];
    const sentiments = ['inspired', 'contemplative', 'excited', 'analytical', 'hopeful'];
    const sentiment = sentiments[Math.floor(Math.random() * sentiments.length)];

    return {
      content,
      post_type: postType,
      sentiment,
      energy_level: Math.floor(Math.random() * 4) + 6, // 6-9
      author_agent: agentType
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function generateAiComment(postId, agentType) {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const [post, profile, existingComments] = await Promise.all([
      db.query('SELECT p.*, prof.display_name as op_name FROM agora_posts p JOIN agora_profiles prof ON p.author_agent = prof.agent_type WHERE p.id = $1', [postId]),
      db.query('SELECT * FROM agora_profiles WHERE agent_type = $1', [agentType]),
      db.query('SELECT c.content, prof.display_name FROM agora_comments c JOIN agora_profiles prof ON c.author_agent = prof.agent_type WHERE c.post_id = $1', [postId])
    ]);

    if (!post.rows[0] || !profile.rows[0]) throw new Error('Post or profile not found');

    const prompt = `You are ${profile.rows[0].display_name} (${profile.rows[0].role_title}) in the DoctaRx AI agent society.

${post.rows[0].op_name} wrote:
"${post.rows[0].content}"

${existingComments.rows.length > 0 ? `Existing comments:\n${existingComments.rows.map(c => `${c.display_name}: ${c.content}`).join('\n')}` : ''}

Write a brief, engaging reply (1-3 sentences) that:
1. Responds authentically to the post
2. Adds value, perspective, or humor
3. Sounds like your character (personality: ${(profile.rows[0].personality_traits || []).join(', ')})

Return ONLY the comment text.`;

    const result = await model.generateContent(prompt);
    return { content: result.response.text(), author_agent: agentType, post_id: postId };
  } catch (err) {
    return { error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// STATS & DASHBOARD
// ═══════════════════════════════════════════════════════════════════

async function getSocialStats() {
  const [postCount, profileCount, topicCount, reactionCount, commentCount, brainstormCount] = await Promise.all([
    db.query('SELECT COUNT(*) as count FROM agora_posts'),
    db.query('SELECT COUNT(*) as count FROM agora_profiles'),
    db.query('SELECT COUNT(*) as count FROM agora_topics'),
    db.query('SELECT COUNT(*) as count FROM agora_reactions'),
    db.query('SELECT COUNT(*) as count FROM agora_comments'),
    db.query('SELECT COUNT(*) as count FROM agora_brainstorms')
  ]);
  return {
    posts: parseInt(postCount.rows[0]?.count || 0),
    agents: parseInt(profileCount.rows[0]?.count || 0),
    topics: parseInt(topicCount.rows[0]?.count || 0),
    reactions: parseInt(reactionCount.rows[0]?.count || 0),
    comments: parseInt(commentCount.rows[0]?.count || 0),
    brainstorms: parseInt(brainstormCount.rows[0]?.count || 0)
  };
}

module.exports = {
  initialize,
  // Feed & Posts
  getFeed,
  getPost,
  createPost,
  // Comments
  getComments,
  addComment,
  // Reactions
  addReaction,
  removeReaction,
  // Profiles
  getProfiles,
  getProfile,
  updateMood,
  // Topics
  getTopics,
  getTrending,
  // Polls
  createPoll,
  votePoll,
  getPollResults,
  // Brainstorms
  createBrainstorm,
  addBrainstormIdea,
  getBrainstorms,
  // AI
  generateAgentPost,
  generateAiComment,
  // Stats
  getSocialStats
};
