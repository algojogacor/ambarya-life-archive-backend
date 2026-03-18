import db from './database';

export const runMigrations = async () => {
  const migrations = [
    // ── Existing ──────────────────────────────────────────────────────────────
    `ALTER TABLE entries ADD COLUMN music_title TEXT`,
    `ALTER TABLE entries ADD COLUMN music_artist TEXT`,
    `ALTER TABLE entries ADD COLUMN music_album_art TEXT`,
    `ALTER TABLE entries ADD COLUMN music_preview_url TEXT`,
    `ALTER TABLE entries ADD COLUMN music_itunes_url TEXT`,
    `ALTER TABLE entries ADD COLUMN step_count INTEGER`,
    `ALTER TABLE entries ADD COLUMN energy_level INTEGER`,
    `ALTER TABLE entries ADD COLUMN sleep_hours REAL`,

    // ── Phase 1: Social ───────────────────────────────────────────────────────

    `ALTER TABLE entries ADD COLUMN visibility TEXT DEFAULT 'private'`,

    `CREATE TABLE IF NOT EXISTS social_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      bio TEXT,
      avatar_url TEXT,
      is_bot INTEGER DEFAULT 0,
      bot_topics TEXT DEFAULT '[]',
      bot_sources TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,

    `CREATE TABLE IF NOT EXISTS follows (
      id TEXT PRIMARY KEY,
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(follower_id, following_id),
      FOREIGN KEY (follower_id) REFERENCES users(id),
      FOREIGN KEY (following_id) REFERENCES users(id)
    )`,

    `CREATE TABLE IF NOT EXISTS feed_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      entry_id TEXT,
      content TEXT,
      media TEXT DEFAULT '[]',
      visibility TEXT DEFAULT 'public',
      is_bot_post INTEGER DEFAULT 0,
      source_url TEXT,
      source_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (entry_id) REFERENCES entries(id)
    )`,

    `CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'like',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, post_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (post_id) REFERENCES feed_posts(id)
    )`,

    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      content TEXT NOT NULL,
      parent_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (post_id) REFERENCES feed_posts(id)
    )`,

    `CREATE TABLE IF NOT EXISTS social_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      type TEXT NOT NULL,
      post_id TEXT,
      comment_id TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (actor_id) REFERENCES users(id)
    )`,

    `ALTER TABLE feed_posts ADD COLUMN updated_at TEXT`,

    // ── Phase 3: Bot System ───────────────────────────────────────────────────

    `CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      bio TEXT,
      topics TEXT DEFAULT '[]',
      sources TEXT DEFAULT '[]',
      post_frequency_min INTEGER DEFAULT 1,
      post_frequency_max INTEGER DEFAULT 5,
      interact_frequency_min INTEGER DEFAULT 3,
      interact_frequency_max INTEGER DEFAULT 10,
      is_active INTEGER DEFAULT 1,
      last_post_at TEXT,
      last_interact_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,

    `CREATE TABLE IF NOT EXISTS bot_schedules (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      action TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      executed_at TEXT,
      status TEXT DEFAULT 'pending',
      meta TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (bot_id) REFERENCES bots(id)
    )`,

    // ── Phase 4: Bisikan Jiwa ─────────────────────────────────────────────────

    // Post confess anonim
    `CREATE TABLE IF NOT EXISTS confess_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NULL,
      original_content TEXT,
      polished_content TEXT NOT NULL,
      display_name TEXT NOT NULL,
      mood_tag TEXT DEFAULT 'sedih',
      relate_count INTEGER DEFAULT 0,
      is_bot_post INTEGER DEFAULT 0,
      ai_replied INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,

    // Komentar confess
    `CREATE TABLE IF NOT EXISTS confess_comments (
      id TEXT PRIMARY KEY,
      confess_id TEXT NOT NULL,
      user_id TEXT NULL,
      content TEXT NOT NULL,
      is_ai_reply INTEGER DEFAULT 0,
      parent_id TEXT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (confess_id) REFERENCES confess_posts(id)
    )`,

    // Context memory AI per thread — anti lupa
    `CREATE TABLE IF NOT EXISTS confess_ai_context (
      id TEXT PRIMARY KEY,
      confess_id TEXT UNIQUE NOT NULL,
      context_summary TEXT DEFAULT '',
      total_comments INTEGER DEFAULT 0,
      last_updated TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (confess_id) REFERENCES confess_posts(id)
    )`,

    `CREATE TABLE IF NOT EXISTS confess_reply_queue (
      id TEXT PRIMARY KEY,
      confess_id TEXT NOT NULL,
      trigger_comment_id TEXT NOT NULL,
      process_after TEXT NOT NULL,
      processed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (confess_id) REFERENCES confess_posts(id)
    )`,

    // Tracking relate user — anti double relate
    `CREATE TABLE IF NOT EXISTS confess_relates (
      id TEXT PRIMARY KEY,
      confess_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(confess_id, user_id),
      FOREIGN KEY (confess_id) REFERENCES confess_posts(id)
    )`,
  ];

  for (const sql of migrations) {
    try {
      await db.execute(sql);
      console.log(`✅ Migration OK: ${sql.substring(0, 60)}...`);
    } catch (e: any) {
      if (
        e.message?.includes('duplicate column') ||
        e.message?.includes('already exists') ||
        e.message?.includes('UNIQUE constraint')
      ) {
        console.log(`⏭️  Skip (already exists): ${sql.substring(0, 60)}...`);
      } else {
        console.error(`❌ Migration failed: ${sql.substring(0, 60)}`, e.message);
      }
    }
  }

  console.log('✅ All migrations done');
};