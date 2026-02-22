-- Social Media Automation Tables
-- Migration: 015_social_media.sql

-- Social Media Accounts
CREATE TABLE IF NOT EXISTS social_accounts (
  id VARCHAR(255) PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL, -- tiktok, instagram, youtube, twitter, facebook
  handle VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  status VARCHAR(50) DEFAULT 'active', -- active, revoked, expired
  connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_posted_at TIMESTAMP,
  post_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform, handle, user_id)
);

-- Social Media Posts (content to be published)
CREATE TABLE IF NOT EXISTS social_posts (
  id VARCHAR(255) PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  video_file_path VARCHAR(500),
  caption TEXT,
  hashtags TEXT, -- JSON array: ["#hashtag1", "#hashtag2"]
  status VARCHAR(50) DEFAULT 'draft', -- draft, scheduled, published, failed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  scheduled_time TIMESTAMP,
  published_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Social Media Platform Posts (actual posts on each platform)
CREATE TABLE IF NOT EXISTS social_platform_posts (
  id VARCHAR(255) PRIMARY KEY,
  post_id VARCHAR(255) REFERENCES social_posts(id) ON DELETE CASCADE,
  account_id VARCHAR(255) REFERENCES social_accounts(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  platform_post_id VARCHAR(500),
  platform_url VARCHAR(1000),
  status VARCHAR(50) DEFAULT 'pending', -- pending, published, failed
  views INT DEFAULT 0,
  likes INT DEFAULT 0,
  comments INT DEFAULT 0,
  shares INT DEFAULT 0,
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Social Media Queue (scheduled posts)
CREATE TABLE IF NOT EXISTS social_queue (
  id VARCHAR(255) PRIMARY KEY,
  post_id VARCHAR(255) REFERENCES social_posts(id) ON DELETE CASCADE,
  account_id VARCHAR(255) REFERENCES social_accounts(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  scheduled_for TIMESTAMP NOT NULL,
  status VARCHAR(50) DEFAULT 'pending', -- pending, processing, published, failed
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_scheduled_for (scheduled_for),
  INDEX idx_status (status)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_social_accounts_user ON social_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON social_accounts(platform);
CREATE INDEX IF NOT EXISTS idx_social_posts_user ON social_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
CREATE INDEX IF NOT EXISTS idx_social_platform_posts_post ON social_platform_posts(post_id);
CREATE INDEX IF NOT EXISTS idx_social_platform_posts_account ON social_platform_posts(account_id);
CREATE INDEX IF NOT EXISTS idx_social_queue_status ON social_queue(status);
