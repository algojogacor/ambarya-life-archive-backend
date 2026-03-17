// backend/src/services/bot.service.ts

import { v4 as uuidv4 } from 'uuid';
import type { InValue } from '@libsql/client';
import db from '../db/database';
import { fetchContentByTopic } from './scraper.service';
import logger from './logger.service';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const a = (v: unknown): InValue => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return String(v);
};

const str = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return String(v[0]);
  if (v === null || v === undefined) return '';
  return String(v);
};

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// Random delay untuk simulasi perilaku manusia
const randomDelay = (minMs: number, maxMs: number) =>
  new Promise(resolve => setTimeout(resolve, randInt(minMs, maxMs)));

// Komentar generik yang natural
const GENERIC_COMMENTS = [
  'Bagus banget ini! 👍',
  'Relate banget sama ini...',
  'Makasih udah share!',
  'Wah, baru tau nih 🤔',
  'Setuju banget!',
  'Mantap jiwa 🔥',
  'Inspiratif sekali ✨',
  'Semangat terus ya!',
  'Keren banget!',
  'Ini yang aku butuhkan hari ini 🙏',
  'Thanks for sharing',
  'So true!',
  'Noted! 📝',
  'Interesting banget!',
  'Love this ❤️',
  'Wih beneran nih? 😮',
  'Harus dicoba nih',
  'Makasih infonya!',
  'Bermanfaat banget',
  'Udah lama cari info ini',
];

const getRandomComment = () =>
  GENERIC_COMMENTS[Math.floor(Math.random() * GENERIC_COMMENTS.length)];

// ─── BOT TEMPLATES ────────────────────────────────────────────────────────────

const BOT_TEMPLATES = [
  {
    name: 'Berita Terkini',
    username: 'berita_terkini',
    bio: 'Update berita terbaru dari Indonesia dan dunia 📰',
    topics: ['news'],
    postFreqMin: 2, postFreqMax: 5,
    interactFreqMin: 5, interactFreqMax: 15,
  },
  {
    name: 'Motivasi Harian',
    username: 'motivasi_harian',
    bio: 'Quotes dan motivasi untuk harimu 💪✨',
    topics: ['quotes', 'motivational'],
    postFreqMin: 3, postFreqMax: 6,
    interactFreqMin: 8, interactFreqMax: 20,
  },
  {
    name: 'Dakwah Islam',
    username: 'dakwah_islam',
    bio: 'Berbagi hikmah dan ilmu Islam 🌙🤲',
    topics: ['islamic', 'dakwah'],
    postFreqMin: 2, postFreqMax: 4,
    interactFreqMin: 3, interactFreqMax: 10,
  },
  {
    name: 'Tech News',
    username: 'tech_news_id',
    bio: 'Berita teknologi terkini dari seluruh dunia 💻🚀',
    topics: ['tech'],
    postFreqMin: 1, postFreqMax: 3,
    interactFreqMin: 4, interactFreqMax: 12,
  },
  {
    name: 'Fakta Unik',
    username: 'fakta_unik',
    bio: 'Fakta-fakta unik dan menarik yang jarang diketahui 🧠',
    topics: ['facts'],
    postFreqMin: 2, postFreqMax: 4,
    interactFreqMin: 6, interactFreqMax: 18,
  },
  {
    name: 'Life Tips',
    username: 'life_tips_id',
    bio: 'Tips kehidupan, psikologi, dan pengembangan diri 🌱',
    topics: ['life', 'quotes'],
    postFreqMin: 2, postFreqMax: 5,
    interactFreqMin: 5, interactFreqMax: 15,
  },
];

// ─── INIT BOTS ────────────────────────────────────────────────────────────────

export const initBots = async (): Promise<void> => {
  logger.info('Bot: Initializing bots...');

  for (const template of BOT_TEMPLATES) {
    try {
      const existing = await db.execute({
        sql: 'SELECT id FROM social_profiles WHERE username = ?',
        args: [a(template.username)]
      });
      if (existing.rows.length > 0) continue;

      const botUserId = uuidv4();
      await db.execute({
        sql: `INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)`,
        args: [a(botUserId), a(template.name), a(`${template.username}@bot.ambarya.app`), a('bot_no_login')]
      });

      await db.execute({
        sql: `INSERT INTO social_profiles (id, user_id, username, display_name, bio, is_bot, bot_topics)
              VALUES (?, ?, ?, ?, ?, 1, ?)`,
        args: [a(uuidv4()), a(botUserId), a(template.username), a(template.name), a(template.bio), a(JSON.stringify(template.topics))]
      });

      await db.execute({
        sql: `INSERT INTO bots (id, user_id, name, bio, topics, sources,
              post_frequency_min, post_frequency_max, interact_frequency_min, interact_frequency_max)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          a(uuidv4()), a(botUserId), a(template.name), a(template.bio),
          a(JSON.stringify(template.topics)), a(JSON.stringify(['rss', 'api'])),
          a(template.postFreqMin), a(template.postFreqMax),
          a(template.interactFreqMin), a(template.interactFreqMax),
        ]
      });

      logger.info('Bot: Created', { username: template.username });
    } catch (err) {
      logger.error('Bot: Failed to create', { username: template.username, err });
    }
  }

  logger.info('Bot: Init complete');
};

// ─── BOT POST ─────────────────────────────────────────────────────────────────

export const runBotPosts = async (): Promise<void> => {
  logger.info('Bot: Running bot posts...');

  const bots = await db.execute({
    sql: `SELECT b.*, sp.user_id FROM bots b
          JOIN social_profiles sp ON sp.user_id = b.user_id
          WHERE b.is_active = 1`,
    args: []
  });

  for (const bot of bots.rows as any[]) {
    try {
      // ✅ RANDOM: setiap bot punya probabilitas berbeda berdasarkan freq setting
      // Bot dengan freq tinggi lebih sering aktif
      const activationChance = bot.post_frequency_max / 10; // max 10 = 100% chance
      const shouldPost = Math.random() < activationChance;
      if (!shouldPost) continue;

      // ✅ RANDOM: jumlah post berbeda tiap run
      const postCount = randInt(1, Math.min(bot.post_frequency_max, 3));
      const topics: string[] = JSON.parse(str(bot.topics) || '["quotes"]');

      for (let i = 0; i < postCount; i++) {
        // ✅ RANDOM: delay antar post berbeda-beda (30 detik - 5 menit)
        await randomDelay(30_000, 300_000);

        const topic = topics[Math.floor(Math.random() * topics.length)];
        const content = await fetchContentByTopic(topic);
        if (!content) continue;

        const postId = uuidv4();
        const now = new Date().toISOString();

        // ✅ Sertakan gambar jika ada dari scraper
        const mediaJson = content.imageUrl
          ? JSON.stringify([{ url: content.imageUrl, type: 'image', name: 'thumbnail' }])
          : '[]';

        await db.execute({
          sql: `INSERT INTO feed_posts (id, user_id, content, media, visibility, is_bot_post, source_url, source_name, created_at)
                VALUES (?, ?, ?, ?, 'public', 1, ?, ?, ?)`,
          args: [
            a(postId), a(str(bot.user_id)),
            a(content.content),
            a(mediaJson),
            a(content.sourceUrl || null),
            a(content.sourceName || null),
            a(now)
          ]
        });

        logger.info('Bot: Posted', { bot: bot.name, topic, hasImage: !!content.imageUrl });
      }

      await db.execute({
        sql: 'UPDATE bots SET last_post_at = ? WHERE id = ?',
        args: [a(new Date().toISOString()), a(str(bot.id))]
      });
    } catch (err) {
      logger.error('Bot: Post failed', { bot: bot.name, err });
    }
  }
};

// ─── BOT INTERACT (like & comment saja, NO follow) ───────────────────────────

export const runBotInteractions = async (): Promise<void> => {
  logger.info('Bot: Running interactions...');

  const bots = await db.execute({
    sql: `SELECT b.*, sp.user_id FROM bots b
          JOIN social_profiles sp ON sp.user_id = b.user_id
          WHERE b.is_active = 1`,
    args: []
  });

  // Ambil post publik terbaru dari user manusia
  const recentPosts = await db.execute({
    sql: `SELECT fp.id, fp.user_id FROM feed_posts fp
          JOIN social_profiles sp ON sp.user_id = fp.user_id
          WHERE fp.visibility = 'public' AND sp.is_bot = 0
          ORDER BY fp.created_at DESC LIMIT 30`,
    args: []
  });

  if (recentPosts.rows.length === 0) return;

  for (const bot of bots.rows as any[]) {
    try {
      // ✅ RANDOM: probabilitas interaksi berbeda per bot
      const activationChance = bot.interact_frequency_max / 25;
      const shouldInteract = Math.random() < Math.min(activationChance, 0.7);
      if (!shouldInteract) continue;

      // ✅ RANDOM: jumlah interaksi berbeda tiap run
      const interactCount = randInt(
        Math.ceil(bot.interact_frequency_min / 2),
        Math.min(bot.interact_frequency_max, 8)
      );

      const shuffled = [...recentPosts.rows].sort(() => Math.random() - 0.5);
      const targetPosts = shuffled.slice(0, Math.min(interactCount, shuffled.length));

      for (const post of targetPosts as any[]) {
        // ✅ RANDOM: delay antar interaksi (10 detik - 2 menit)
        await randomDelay(10_000, 120_000);

        // ✅ Hanya like atau komentar — NO follow
        const action = Math.random();
        if (action < 0.65) {
          // 65% → like
          await _botLike(str(bot.user_id), str(post.id));
        } else {
          // 35% → komentar
          await _botComment(str(bot.user_id), str(post.id));
        }
      }

      await db.execute({
        sql: 'UPDATE bots SET last_interact_at = ? WHERE id = ?',
        args: [a(new Date().toISOString()), a(str(bot.id))]
      });
    } catch (err) {
      logger.error('Bot: Interact failed', { bot: bot.name, err });
    }
  }
};

// ─── PRIVATE HELPERS ──────────────────────────────────────────────────────────

const _botLike = async (botUserId: string, postId: string): Promise<void> => {
  const existing = await db.execute({
    sql: 'SELECT id FROM reactions WHERE user_id = ? AND post_id = ?',
    args: [a(botUserId), a(postId)]
  });
  if (existing.rows.length > 0) return;

  await db.execute({
    sql: 'INSERT INTO reactions (id, user_id, post_id, type) VALUES (?, ?, ?, ?)',
    args: [a(uuidv4()), a(botUserId), a(postId), a('like')]
  });
};

const _botComment = async (botUserId: string, postId: string): Promise<void> => {
  const existing = await db.execute({
    sql: 'SELECT id FROM comments WHERE user_id = ? AND post_id = ? AND parent_id IS NULL',
    args: [a(botUserId), a(postId)]
  });
  if (existing.rows.length > 0) return;

  const comment = getRandomComment();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO comments (id, user_id, post_id, content, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: [a(uuidv4()), a(botUserId), a(postId), a(comment), a(now)]
  });

  // Notifikasi ke pemilik post
  const post = await db.execute({
    sql: 'SELECT user_id FROM feed_posts WHERE id = ?',
    args: [a(postId)]
  });
  const postOwnerId = post.rows[0] ? str(post.rows[0].user_id) : null;
  if (postOwnerId && postOwnerId !== botUserId) {
    await db.execute({
      sql: `INSERT INTO social_notifications (id, user_id, actor_id, type, post_id) VALUES (?, ?, ?, 'comment', ?)`,
      args: [a(uuidv4()), a(postOwnerId), a(botUserId), a(postId)]
    });
  }
};