/**
 * Agent Social Media API Routes — "The Agora"
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');

const adminOnly = [authenticate, requireRole('admin', 'super_admin')];

let socialService;
try {
  socialService = require('../services/agentSocialService');
} catch (err) {
  console.warn('Agent Social service not available:', err.message);
}

// ═══ FEED ═══
router.get('/feed', ...adminOnly, async (req, res) => {
  try {
    const feed = await socialService.getFeed(req.query);
    res.json({ success: true, data: feed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ SINGLE POST ═══
router.get('/posts/:id', ...adminOnly, async (req, res) => {
  try {
    const post = await socialService.getPost(req.params.id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    res.json({ success: true, data: post });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ CREATE POST ═══
router.post('/posts', ...adminOnly, async (req, res) => {
  try {
    const post = await socialService.createPost(req.body);
    res.status(201).json({ success: true, data: post });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ COMMENTS ═══
router.get('/posts/:id/comments', ...adminOnly, async (req, res) => {
  try {
    const comments = await socialService.getComments(req.params.id);
    res.json({ success: true, data: comments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/comments', ...adminOnly, async (req, res) => {
  try {
    const comment = await socialService.addComment(req.body);
    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ REACTIONS ═══
router.post('/reactions', ...adminOnly, async (req, res) => {
  try {
    const { postId, agentType, reactionType } = req.body;
    const result = await socialService.addReaction(postId, agentType, reactionType);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/reactions', ...adminOnly, async (req, res) => {
  try {
    const { postId, agentType, reactionType } = req.body;
    const result = await socialService.removeReaction(postId, agentType, reactionType);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ PROFILES ═══
router.get('/profiles', ...adminOnly, async (req, res) => {
  try {
    const profiles = await socialService.getProfiles();
    res.json({ success: true, data: profiles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/profiles/:agentType', ...adminOnly, async (req, res) => {
  try {
    const profile = await socialService.getProfile(req.params.agentType);
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/profiles/:agentType/mood', ...adminOnly, async (req, res) => {
  try {
    const result = await socialService.updateMood(req.params.agentType, req.body.mood, req.body.statusMessage);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ TOPICS ═══
router.get('/topics', ...adminOnly, async (req, res) => {
  try {
    const topics = await socialService.getTopics();
    res.json({ success: true, data: topics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ TRENDING ═══
router.get('/trending', ...adminOnly, async (req, res) => {
  try {
    const trending = await socialService.getTrending();
    res.json({ success: true, data: trending });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ POLLS ═══
router.post('/polls', ...adminOnly, async (req, res) => {
  try {
    const poll = await socialService.createPoll(req.body);
    res.status(201).json({ success: true, data: poll });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/polls/:id/vote', ...adminOnly, async (req, res) => {
  try {
    const result = await socialService.votePoll(req.params.id, req.body.agentType, req.body.optionIndex);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/polls/:id/results', ...adminOnly, async (req, res) => {
  try {
    const results = await socialService.getPollResults(req.params.id);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ BRAINSTORMS ═══
router.get('/brainstorms', ...adminOnly, async (req, res) => {
  try {
    const brainstorms = await socialService.getBrainstorms();
    res.json({ success: true, data: brainstorms });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/brainstorms', ...adminOnly, async (req, res) => {
  try {
    const brainstorm = await socialService.createBrainstorm(req.body);
    res.status(201).json({ success: true, data: brainstorm });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/brainstorms/:id/idea', ...adminOnly, async (req, res) => {
  try {
    const result = await socialService.addBrainstormIdea(req.params.id, req.body.agentType, req.body.idea);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ AI GENERATION ═══
router.post('/ai/generate-post', ...adminOnly, async (req, res) => {
  try {
    const { agentType, hint } = req.body;
    if (!agentType) return res.status(400).json({ success: false, error: 'agentType required' });
    const generated = await socialService.generateAgentPost(agentType, hint);
    if (generated.error) return res.status(500).json({ success: false, error: generated.error });
    res.json({ success: true, data: generated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/ai/generate-comment', ...adminOnly, async (req, res) => {
  try {
    const { postId, agentType } = req.body;
    if (!postId || !agentType) return res.status(400).json({ success: false, error: 'postId and agentType required' });
    const generated = await socialService.generateAiComment(postId, agentType);
    if (generated.error) return res.status(500).json({ success: false, error: generated.error });
    res.json({ success: true, data: generated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ STATS ═══
router.get('/stats', ...adminOnly, async (req, res) => {
  try {
    const stats = await socialService.getSocialStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
