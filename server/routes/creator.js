const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'creator');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * Creator API Routes
 * POST /api/creator/submit-video - Upload & analyze video
 * POST /api/creator/auto-generate - Generate captions/hashtags
 * POST /api/creator/publish - Publish to platforms
 * POST /api/creator/schedule - Schedule post
 * GET /api/creator/content - List all content
 * GET /api/creator/analytics - Get performance data
 * GET /api/creator/queue - Get publishing queue
 */

// POST: Submit video for processing
router.post('/submit-video', async (req, res) => {
  try {
    const { fileName, title, description } = req.body;
    
    if (!fileName || !title) {
      return res.status(400).json({ success: false, error: 'Missing fileName or title' });
    }

    const videoId = `video_${Date.now()}`;
    const content = {
      id: videoId,
      fileName,
      title,
      description,
      status: 'processing',
      createdAt: new Date().toISOString(),
      captions: null,
      hashtags: null,
      platforms: [],
    };

    // Save metadata
    fs.writeFileSync(
      path.join(UPLOAD_DIR, `${videoId}.json`),
      JSON.stringify(content, null, 2)
    );

    res.json({ success: true, videoId, message: 'Video uploaded successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Auto-generate captions & hashtags
router.post('/auto-generate', async (req, res) => {
  try {
    const { videoId, transcription } = req.body;

    if (!videoId) {
      return res.status(400).json({ success: false, error: 'Missing videoId' });
    }

    // Mock AI generation (would call Whisper API + Claude for real)
    const mockCaptions = transcription || 'Auto-generated captions from video speech recognition';
    const mockHashtags = ['#telemedicine', '#healthtech', '#AI', '#telehealth', '#doctarx'];
    const mockEnhancements = 'Bright, engaging captions with medical authority';

    // Update content metadata
    const metaPath = path.join(UPLOAD_DIR, `${videoId}.json`);
    if (fs.existsSync(metaPath)) {
      const content = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      content.captions = mockCaptions;
      content.hashtags = mockHashtags;
      content.enhancements = mockEnhancements;
      content.status = 'ready';
      fs.writeFileSync(metaPath, JSON.stringify(content, null, 2));
    }

    res.json({
      success: true,
      captions: mockCaptions,
      hashtags: mockHashtags.join(' '),
      enhancements: mockEnhancements,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Publish to platforms
router.post('/publish', async (req, res) => {
  try {
    const { videoId, platforms, title, description, hashtags } = req.body;

    if (!videoId || !platforms || platforms.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing videoId or platforms' });
    }

    // Mock publish (would call platform APIs for real)
    const publishedTo = platforms.map(p => ({
      platform: p,
      postId: `${p}_${Date.now()}`,
      url: `https://${p}.com/post/${Date.now()}`,
      status: 'published',
      timestamp: new Date().toISOString(),
    }));

    // Update content
    const metaPath = path.join(UPLOAD_DIR, `${videoId}.json`);
    if (fs.existsSync(metaPath)) {
      const content = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      content.platforms = publishedTo;
      content.status = 'published';
      fs.writeFileSync(metaPath, JSON.stringify(content, null, 2));
    }

    res.json({
      success: true,
      message: `Published to ${platforms.length} platforms`,
      publishedTo,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Schedule post for later
router.post('/schedule', async (req, res) => {
  try {
    const { videoId, scheduledTime, platforms } = req.body;

    if (!videoId || !scheduledTime) {
      return res.status(400).json({ success: false, error: 'Missing videoId or scheduledTime' });
    }

    const metaPath = path.join(UPLOAD_DIR, `${videoId}.json`);
    if (fs.existsSync(metaPath)) {
      const content = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      content.scheduledTime = scheduledTime;
      content.scheduledPlatforms = platforms || [];
      content.status = 'scheduled';
      fs.writeFileSync(metaPath, JSON.stringify(content, null, 2));
    }

    res.json({
      success: true,
      message: `Scheduled for ${new Date(scheduledTime).toLocaleString()}`,
      scheduledTime,
      platforms: platforms || [],
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: List all content
router.get('/content', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.endsWith('.json'));
    const content = files.map(f => 
      JSON.parse(fs.readFileSync(path.join(UPLOAD_DIR, f), 'utf-8'))
    );

    res.json({ success: true, content });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Analytics
router.get('/analytics', (req, res) => {
  try {
    const mockAnalytics = {
      totalVideos: 5,
      published: 4,
      scheduled: 1,
      totalViews: 12450,
      totalEngagement: 847,
      topPlatform: 'TikTok',
      engagement_rate: '6.8%',
      growth_rate: '+12% week-over-week',
    };

    res.json({ success: true, analytics: mockAnalytics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Publishing queue
router.get('/queue', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.endsWith('.json'));
    const queue = files
      .map(f => JSON.parse(fs.readFileSync(path.join(UPLOAD_DIR, f), 'utf-8')))
      .filter(c => c.status === 'scheduled' || c.status === 'ready')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, queue });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
