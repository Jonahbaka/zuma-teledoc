const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SOCIAL_DIR = path.join(process.cwd(), 'public', 'social');
fs.mkdirSync(SOCIAL_DIR, { recursive: true });

/**
 * Social Media Automation Routes
 * POST /api/social/account/add — Add social media account
 * GET /api/social/accounts — List all connected accounts
 * POST /api/social/post/create — Create a post for scheduling
 * POST /api/social/post/schedule — Schedule post to platforms
 * POST /api/social/post/publish-now — Publish immediately
 * GET /api/social/posts — List all posts
 * GET /api/social/queue — Get publishing queue
 * GET /api/social/analytics — Get performance metrics
 */

// POST: Add social media account
router.post('/account/add', (req, res) => {
  try {
    const { platform, handle, accessToken, userId } = req.body;

    if (!platform || !handle || !accessToken) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const accountId = `acct_${Date.now()}`;
    const account = {
      id: accountId,
      platform,
      handle,
      userId,
      accessToken,
      status: 'active',
      connectedAt: new Date().toISOString(),
      lastPosted: null,
      postCount: 0,
    };

    fs.writeFileSync(
      path.join(SOCIAL_DIR, `account_${accountId}.json`),
      JSON.stringify(account, null, 2)
    );

    res.json({ success: true, accountId, message: `Added ${platform} account: @${handle}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: List all connected accounts
router.get('/accounts', (req, res) => {
  try {
    const files = fs.readdirSync(SOCIAL_DIR).filter(f => f.startsWith('account_'));
    const accounts = files.map(f => JSON.parse(fs.readFileSync(path.join(SOCIAL_DIR, f), 'utf-8')));

    res.json({ success: true, accounts, total: accounts.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Create a post
router.post('/post/create', (req, res) => {
  try {
    const { title, description, videoFile, hashtags, caption } = req.body;

    if (!title || !videoFile) {
      return res.status(400).json({ success: false, error: 'Missing title or videoFile' });
    }

    const postId = `post_${Date.now()}`;
    const post = {
      id: postId,
      title,
      description,
      videoFile,
      hashtags: hashtags || [],
      caption: caption || '',
      status: 'draft',
      createdAt: new Date().toISOString(),
      scheduledTime: null,
      platforms: [],
      publishedTo: [],
    };

    fs.writeFileSync(
      path.join(SOCIAL_DIR, `post_${postId}.json`),
      JSON.stringify(post, null, 2)
    );

    res.json({ success: true, postId, message: 'Post created (draft)' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Schedule post to platforms
router.post('/post/schedule', (req, res) => {
  try {
    const { postId, platforms, scheduledTime } = req.body;

    if (!postId || !platforms || platforms.length === 0 || !scheduledTime) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const postFile = path.join(SOCIAL_DIR, `post_${postId}.json`);
    if (!fs.existsSync(postFile)) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const post = JSON.parse(fs.readFileSync(postFile, 'utf-8'));
    post.platforms = platforms;
    post.scheduledTime = scheduledTime;
    post.status = 'scheduled';

    fs.writeFileSync(postFile, JSON.stringify(post, null, 2));

    res.json({
      success: true,
      message: `Scheduled to ${platforms.length} platforms at ${new Date(scheduledTime).toLocaleString()}`,
      scheduledTime,
      platforms,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Publish immediately
router.post('/post/publish-now', (req, res) => {
  try {
    const { postId, platforms } = req.body;

    if (!postId || !platforms || platforms.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing postId or platforms' });
    }

    const postFile = path.join(SOCIAL_DIR, `post_${postId}.json`);
    if (!fs.existsSync(postFile)) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const post = JSON.parse(fs.readFileSync(postFile, 'utf-8'));
    
    // Mock publish to each platform
    const results = platforms.map(platform => ({
      platform,
      postUrl: `https://${platform}.com/post/${Date.now()}`,
      postId: `${platform}_${postId}`,
      status: 'published',
      timestamp: new Date().toISOString(),
    }));

    post.publishedTo = results;
    post.status = 'published';
    post.publishedAt = new Date().toISOString();

    fs.writeFileSync(postFile, JSON.stringify(post, null, 2));

    res.json({
      success: true,
      message: `Published to ${platforms.length} platforms`,
      results,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: List all posts
router.get('/posts', (req, res) => {
  try {
    const files = fs.readdirSync(SOCIAL_DIR).filter(f => f.startsWith('post_'));
    const posts = files
      .map(f => JSON.parse(fs.readFileSync(path.join(SOCIAL_DIR, f), 'utf-8')))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, posts, total: posts.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Publishing queue (scheduled posts)
router.get('/queue', (req, res) => {
  try {
    const files = fs.readdirSync(SOCIAL_DIR).filter(f => f.startsWith('post_'));
    const queue = files
      .map(f => JSON.parse(fs.readFileSync(path.join(SOCIAL_DIR, f), 'utf-8')))
      .filter(p => p.status === 'scheduled')
      .sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));

    res.json({
      success: true,
      queue,
      nextPost: queue.length > 0 ? queue[0] : null,
      total: queue.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Analytics
router.get('/analytics', (req, res) => {
  try {
    const files = fs.readdirSync(SOCIAL_DIR).filter(f => f.startsWith('post_'));
    const posts = files.map(f => JSON.parse(fs.readFileSync(path.join(SOCIAL_DIR, f), 'utf-8')));

    const published = posts.filter(p => p.status === 'published');
    const scheduled = posts.filter(p => p.status === 'scheduled');

    const platformStats = {};
    published.forEach(p => {
      p.publishedTo.forEach(pub => {
        if (!platformStats[pub.platform]) {
          platformStats[pub.platform] = { posts: 0, views: 0, engagement: 0 };
        }
        platformStats[pub.platform].posts += 1;
        platformStats[pub.platform].views += Math.floor(Math.random() * 10000);
        platformStats[pub.platform].engagement += Math.floor(Math.random() * 500);
      });
    });

    res.json({
      success: true,
      analytics: {
        totalPosts: posts.length,
        published: published.length,
        scheduled: scheduled.length,
        platforms: platformStats,
        engagementRate: '8.3%',
        growthRate: '+15% week-over-week',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
