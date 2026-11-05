-- Explicit replacement for route-time schema setup. Preserve existing records.

CREATE TABLE IF NOT EXISTS social_accounts (
      id VARCHAR(255) PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      platform VARCHAR(50) NOT NULL,
      handle VARCHAR(255) NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expires_at TIMESTAMP,
      status VARCHAR(50) DEFAULT 'active',
      connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_posted_at TIMESTAMP,
      post_count INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(platform, handle, user_id)
    );
CREATE TABLE IF NOT EXISTS social_posts (
      id VARCHAR(255) PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(500) NOT NULL,
      description TEXT,
      media_url VARCHAR(1000),
      caption TEXT,
      hashtags JSONB DEFAULT '[]',
      platforms JSONB DEFAULT '[]',
      status VARCHAR(50) DEFAULT 'draft',
      scheduled_time TIMESTAMP,
      published_at TIMESTAMP,
      retry_count INT DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE IF NOT EXISTS social_platform_posts (
      id VARCHAR(255) PRIMARY KEY,
      post_id VARCHAR(255) REFERENCES social_posts(id) ON DELETE CASCADE,
      account_id VARCHAR(255) REFERENCES social_accounts(id) ON DELETE SET NULL,
      platform VARCHAR(50) NOT NULL,
      platform_post_id VARCHAR(500),
      platform_url VARCHAR(1000),
      status VARCHAR(50) DEFAULT 'pending',
      views INT DEFAULT 0,
      likes INT DEFAULT 0,
      comments INT DEFAULT 0,
      shares INT DEFAULT 0,
      published_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE IF NOT EXISTS realtime_analytics_events (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'page_view',
      page_path TEXT,
      page_title TEXT,
      source TEXT,
      referrer TEXT,
      device_type TEXT,
      country TEXT,
      city TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
CREATE INDEX IF NOT EXISTS idx_realtime_analytics_events_created_at
      ON realtime_analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_realtime_analytics_events_session
      ON realtime_analytics_events(session_id, created_at DESC);

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS media_url VARCHAR(1000);
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS platforms JSONB DEFAULT '[]';
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS target_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS target_email VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_testing_access_links_target_user_id ON testing_access_links(target_user_id);
CREATE INDEX IF NOT EXISTS idx_testing_access_links_target_email ON testing_access_links(LOWER(target_email));
