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

const randomDelay = (minMs: number, maxMs: number) =>
  new Promise(resolve => setTimeout(resolve, randInt(minMs, maxMs)));

const GENERIC_COMMENTS = [
  'Bagus banget ini! 👍', 'Relate banget sama ini...', 'Makasih udah share!',
  'Wah, baru tau nih 🤔', 'Setuju banget!', 'Mantap jiwa 🔥',
  'Inspiratif sekali ✨', 'Semangat terus ya!', 'Keren banget!',
  'Ini yang aku butuhkan hari ini 🙏', 'Thanks for sharing', 'So true!',
  'Noted! 📝', 'Interesting banget!', 'Love this ❤️',
  'Wih beneran nih? 😮', 'Harus dicoba nih', 'Makasih infonya!',
  'Bermanfaat banget', 'Udah lama cari info ini',
];

const getRandomComment = () =>
  GENERIC_COMMENTS[Math.floor(Math.random() * GENERIC_COMMENTS.length)];

// ─── MAX BOTS ─────────────────────────────────────────────────────────────────
const MAX_BOTS = 50;

// ─── BOT TEMPLATES (seed awal) ────────────────────────────────────────────────
// Ini hanya template awal. Bot baru bisa ditambah via API atau auto-generate.
const BOT_TEMPLATES = [
  { name: 'Berita Terkini', username: 'berita_terkini', bio: 'Update berita terbaru dari Indonesia dan dunia 📰', topics: ['news'], postMin: 2, postMax: 5, interactMin: 5, interactMax: 15 },
  { name: 'Motivasi Harian', username: 'motivasi_harian', bio: 'Quotes dan motivasi untuk harimu 💪✨', topics: ['quotes', 'motivational'], postMin: 3, postMax: 6, interactMin: 8, interactMax: 20 },
  { name: 'Dakwah Islam', username: 'dakwah_islam', bio: 'Berbagi hikmah dan ilmu Islam 🌙🤲', topics: ['islamic', 'dakwah'], postMin: 2, postMax: 4, interactMin: 3, interactMax: 10 },
  { name: 'Tech News', username: 'tech_news_id', bio: 'Berita teknologi terkini 💻🚀', topics: ['tech'], postMin: 1, postMax: 3, interactMin: 4, interactMax: 12 },
  { name: 'Fakta Unik', username: 'fakta_unik', bio: 'Fakta-fakta unik yang jarang diketahui 🧠', topics: ['facts'], postMin: 2, postMax: 4, interactMin: 6, interactMax: 18 },
  { name: 'Life Tips', username: 'life_tips_id', bio: 'Tips kehidupan dan pengembangan diri 🌱', topics: ['life', 'quotes'], postMin: 2, postMax: 5, interactMin: 5, interactMax: 15 },
  { name: 'Hiburan Seru', username: 'hiburan_seru', bio: 'Konten hiburan dan lifestyle terkini 🎭', topics: ['entertainment'], postMin: 2, postMax: 5, interactMin: 6, interactMax: 16 },
  { name: 'Psikologi Kita', username: 'psikologi_kita', bio: 'Tips kesehatan mental dan psikologi 🧘', topics: ['life'], postMin: 1, postMax: 3, interactMin: 4, interactMax: 12 },
];

// ─── RECENT CONTENT CACHE (anti-duplikat) ─────────────────────────────────────
// Simpan hash konten yang baru saja dipost untuk hindari duplikat
const recentContentHashes = new Set<string>();
const MAX_HASH_CACHE = 500;

const simpleHash = (content: string): string => {
  // Ambil 50 karakter pertama sebagai fingerprint
  return content.trim().toLowerCase().substring(0, 50);
};

const isContentDuplicate = (content: string): boolean => {
  const hash = simpleHash(content);
  return recentContentHashes.has(hash);
};

const markContentUsed = (content: string): void => {
  const hash = simpleHash(content);
  recentContentHashes.add(hash);
  // Kalau cache terlalu besar, hapus yang paling lama
  if (recentContentHashes.size > MAX_HASH_CACHE) {
    const first = recentContentHashes.values().next().value;
    if (first) recentContentHashes.delete(first);
  }
};

// ─── INIT BOTS ────────────────────────────────────────────────────────────────

export const initBots = async (): Promise<void> => {
  logger.info('Bot: Initializing bots...');

  // Cek total bot yang sudah ada
  const countResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM bots WHERE is_active = 1',
    args: []
  });
  const currentBotCount = Number((countResult.rows[0] as any).count);

  if (currentBotCount >= MAX_BOTS) {
    logger.info(`Bot: Already at max (${currentBotCount}/${MAX_BOTS}), skipping init`);
    return;
  }

  for (const template of BOT_TEMPLATES) {
    // Cek total lagi setiap iterasi
    const cnt = await db.execute({ sql: 'SELECT COUNT(*) as count FROM bots WHERE is_active = 1', args: [] });
    if (Number((cnt.rows[0] as any).count) >= MAX_BOTS) {
      logger.info(`Bot: Reached max bots (${MAX_BOTS}), stopping`);
      break;
    }

    try {
      // Cek apakah username sudah ada
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
        sql: `INSERT INTO social_profiles (id, user_id, username, display_name, bio, is_bot, bot_topics) VALUES (?, ?, ?, ?, ?, 1, ?)`,
        args: [a(uuidv4()), a(botUserId), a(template.username), a(template.name), a(template.bio), a(JSON.stringify(template.topics))]
      });
      await db.execute({
        sql: `INSERT INTO bots (id, user_id, name, bio, topics, sources, post_frequency_min, post_frequency_max, interact_frequency_min, interact_frequency_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [a(uuidv4()), a(botUserId), a(template.name), a(template.bio), a(JSON.stringify(template.topics)), a('["rss","ai"]'), a(template.postMin), a(template.postMax), a(template.interactMin), a(template.interactMax)]
      });
      logger.info('Bot: Created', { username: template.username });
    } catch (err) {
      logger.error('Bot: Failed to create', { username: template.username, err });
    }
  }

  logger.info('Bot: Init complete');
};

// ─── AUTO-GROW BOTS (tambah bot baru secara acak) ─────────────────────────────

const BOT_NAME_POOL = [
  { name: 'Berita Pagi', prefix: 'berita_pagi', topics: ['news'], bio: 'Sajian berita hangat setiap pagi ☀️' },
  { name: 'Quote of Day', prefix: 'quote_day', topics: ['quotes'], bio: 'Satu quote setiap hari untuk jiwamu 🌟' },
  { name: 'Info Teknologi', prefix: 'info_tek', topics: ['tech'], bio: 'Dunia teknologi dalam genggamanmu 📱' },
  { name: 'Mutiara Hikmah', prefix: 'mutiara_hikmah', topics: ['islamic'], bio: 'Hikmah dan inspirasi dari Al-Quran 📖' },
  { name: 'Gaya Hidup', prefix: 'gaya_hidup', topics: ['life', 'entertainment'], bio: 'Tips gaya hidup sehat dan bahagia 🌈' },
  { name: 'Fakta Harian', prefix: 'fakta_harian', topics: ['facts'], bio: 'Fakta mengejutkan setiap hari! 😱' },
  { name: 'Motivasi ID', prefix: 'motivasi_id', topics: ['motivational'], bio: 'Bangkit dan raih impianmu! 🚀' },
  { name: 'Ilmu Jiwa', prefix: 'ilmu_jiwa', topics: ['life'], bio: 'Psikologi & kesehatan mental untuk semua 🧠' },
  { name: 'Kabar Dunia', prefix: 'kabar_dunia', topics: ['news'], bio: 'Berita terkini dari seluruh penjuru dunia 🌍' },
  { name: 'Tren Kini', prefix: 'tren_kini', topics: ['entertainment', 'life'], bio: 'Tren terkini yang wajib kamu tau 🔥' },
];

export const growBots = async (): Promise<void> => {
  const countResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM bots WHERE is_active = 1',
    args: []
  });
  const currentCount = Number((countResult.rows[0] as any).count);

  if (currentCount >= MAX_BOTS) {
    logger.info(`Bot: At max capacity (${currentCount}/${MAX_BOTS})`);
    return;
  }

  // Tambah 1-2 bot baru secara acak
  const toAdd = Math.min(randInt(1, 2), MAX_BOTS - currentCount);

  for (let i = 0; i < toAdd; i++) {
    const template = BOT_NAME_POOL[Math.floor(Math.random() * BOT_NAME_POOL.length)];

    // Generate username unik dengan suffix angka
    const suffix = randInt(1, 999);
    const username = `${template.prefix}_${suffix}`;

    // Cek username belum dipakai
    const existing = await db.execute({
      sql: 'SELECT id FROM social_profiles WHERE username = ?',
      args: [a(username)]
    });
    if (existing.rows.length > 0) continue;

    try {
      const botUserId = uuidv4();
      await db.execute({
        sql: `INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)`,
        args: [a(botUserId), a(`${template.name} ${suffix}`), a(`${username}@bot.ambarya.app`), a('bot_no_login')]
      });
      await db.execute({
        sql: `INSERT INTO social_profiles (id, user_id, username, display_name, bio, is_bot, bot_topics) VALUES (?, ?, ?, ?, ?, 1, ?)`,
        args: [a(uuidv4()), a(botUserId), a(username), a(`${template.name} ${suffix}`), a(template.bio), a(JSON.stringify(template.topics))]
      });
      await db.execute({
        sql: `INSERT INTO bots (id, user_id, name, bio, topics, sources, post_frequency_min, post_frequency_max, interact_frequency_min, interact_frequency_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [a(uuidv4()), a(botUserId), a(`${template.name} ${suffix}`), a(template.bio), a(JSON.stringify(template.topics)), a('["rss","ai"]'), a(randInt(1, 3)), a(randInt(4, 7)), a(randInt(3, 8)), a(randInt(10, 20))]
      });
      logger.info('Bot: Auto-grew new bot', { username, currentCount: currentCount + i + 1 });
    } catch (err) {
      logger.error('Bot: Auto-grow failed', { username, err });
    }
  }
};

// ─── BOT POST ─────────────────────────────────────────────────────────────────

export const runBotPosts = async (): Promise<void> => {
  logger.info('Bot: Running bot posts...');

  const bots = await db.execute({
    sql: `SELECT b.*, sp.user_id FROM bots b JOIN social_profiles sp ON sp.user_id = b.user_id WHERE b.is_active = 1`,
    args: []
  });

  // Load recent posts untuk cek duplikat dari DB juga
  const recentPosts = await db.execute({
    sql: `SELECT content FROM feed_posts WHERE is_bot_post = 1 AND created_at > datetime('now', '-2 days') ORDER BY created_at DESC LIMIT 100`,
    args: []
  });
  for (const row of recentPosts.rows as any[]) {
    if (row.content) markContentUsed(str(row.content));
  }

  for (const bot of bots.rows as any[]) {
    try {
      const activationChance = Number(bot.post_frequency_max) / 10;
      if (Math.random() > activationChance) continue;

      const postCount = randInt(1, Math.min(Number(bot.post_frequency_max), 3));
      const topics: string[] = JSON.parse(str(bot.topics) || '["quotes"]');

      for (let i = 0; i < postCount; i++) {
        // ✅ Random delay antar post (1-10 menit)
        await randomDelay(60_000, 600_000);

        const topic = topics[Math.floor(Math.random() * topics.length)];

        // Coba maksimal 3x untuk dapat konten yang tidak duplikat
        let content = null;
        let imageUrl = null;
        let sourceName = null;
        let sourceUrl = null;

        for (let attempt = 0; attempt < 3; attempt++) {
          const fetched = await fetchContentByTopic(topic);
          if (!fetched) break;

          if (!isContentDuplicate(fetched.content)) {
            content = fetched.content;
            imageUrl = fetched.imageUrl || null;
            sourceName = fetched.sourceName || null;
            sourceUrl = fetched.sourceUrl || null;
            break;
          }
          logger.info('Bot: Duplicate content detected, retrying...', { bot: bot.name });
        }

        if (!content) continue;

        // Mark content sebagai sudah dipakai
        markContentUsed(content);

        const postId = uuidv4();
        const now = new Date().toISOString();
        const mediaJson = imageUrl
          ? JSON.stringify([{ url: imageUrl, type: 'image', name: 'thumbnail' }])
          : '[]';

        await db.execute({
          sql: `INSERT INTO feed_posts (id, user_id, content, media, visibility, is_bot_post, source_url, source_name, created_at) VALUES (?, ?, ?, ?, 'public', 1, ?, ?, ?)`,
          args: [a(postId), a(str(bot.user_id)), a(content), a(mediaJson), a(sourceUrl), a(sourceName), a(now)]
        });

        logger.info('Bot: Posted', { bot: bot.name, topic, hasImage: !!imageUrl });
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

// ─── BOT INTERACT ─────────────────────────────────────────────────────────────

export const runBotInteractions = async (): Promise<void> => {
  logger.info('Bot: Running interactions...');

  const bots = await db.execute({
    sql: `SELECT b.*, sp.user_id FROM bots b JOIN social_profiles sp ON sp.user_id = b.user_id WHERE b.is_active = 1`,
    args: []
  });

  const recentPosts = await db.execute({
    sql: `SELECT fp.id, fp.user_id FROM feed_posts fp JOIN social_profiles sp ON sp.user_id = fp.user_id WHERE fp.visibility = 'public' AND sp.is_bot = 0 ORDER BY fp.created_at DESC LIMIT 30`,
    args: []
  });

  if (recentPosts.rows.length === 0) return;

  for (const bot of bots.rows as any[]) {
    try {
      const activationChance = Number(bot.interact_frequency_max) / 25;
      if (Math.random() > Math.min(activationChance, 0.7)) continue;

      const interactCount = randInt(
        Math.ceil(Number(bot.interact_frequency_min) / 2),
        Math.min(Number(bot.interact_frequency_max), 8)
      );

      const shuffled = [...recentPosts.rows].sort(() => Math.random() - 0.5);
      const targets = shuffled.slice(0, Math.min(interactCount, shuffled.length));

      for (const post of targets as any[]) {
        await randomDelay(5_000, 60_000);
        if (Math.random() < 0.65) {
          await _botLike(str(bot.user_id), str(post.id));
        } else {
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

  const post = await db.execute({ sql: 'SELECT user_id FROM feed_posts WHERE id = ?', args: [a(postId)] });
  const postOwnerId = post.rows[0] ? str(post.rows[0].user_id) : null;
  if (postOwnerId && postOwnerId !== botUserId) {
    await db.execute({
      sql: `INSERT INTO social_notifications (id, user_id, actor_id, type, post_id) VALUES (?, ?, ?, 'comment', ?)`,
      args: [a(uuidv4()), a(postOwnerId), a(botUserId), a(postId)]
    });
  }
};