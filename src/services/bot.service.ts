// backend/src/services/bot.service.ts

import { v4 as uuidv4 } from 'uuid';
import type { InValue } from '@libsql/client';
import db from '../db/database';
import { fetchContentByTopic } from './scraper.service';
import logger from './logger.service';

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
  'Bermanfaat banget', 'Udah lama cari info ini', 'Mantap, lanjutkan!',
  'Harus dishare nih 🔥', 'Beneran deh ini penting', 'Wow keren banget!',
];

const getRandomComment = () =>
  GENERIC_COMMENTS[Math.floor(Math.random() * GENERIC_COMMENTS.length)];

const MAX_BOTS = 50;

// ─── BOT TEMPLATES ────────────────────────────────────────────────────────────

const BOT_TEMPLATES = [
  {
    name: 'Rizky Pratama', username: 'rizky.pratama', avatar: null,
    bio: 'Berbagi berita terkini yang perlu kamu tau 📰 | Jurnalis Independen',
    topics: ['news'], postMin: 2, postMax: 5, interactMin: 5, interactMax: 15,
  },
  {
    name: 'Nadia Inspirasi', username: 'nadiainspirasi', avatar: null,
    bio: 'Life coach & motivator ✨ | Setiap hari ada pelajaran baru',
    topics: ['quotes', 'motivational'], postMin: 3, postMax: 6, interactMin: 8, interactMax: 20,
  },
  {
    name: 'Ustadz Fariz', username: 'ustadzfariz', avatar: null,
    bio: 'Berbagi ilmu dan hikmah Islam 🌙 | Semoga bermanfaat dunia akhirat',
    topics: ['islamic', 'dakwah'], postMin: 2, postMax: 4, interactMin: 3, interactMax: 10,
  },
  {
    name: 'Dika Tech', username: 'dikatech.id', avatar: null,
    bio: 'Tech enthusiast 💻 | Review gadget, AI, dan dunia digital',
    topics: ['tech'], postMin: 1, postMax: 3, interactMin: 4, interactMax: 12,
  },
  {
    name: 'Fakta Kita', username: 'faktakita', avatar: null,
    bio: 'Fakta unik dan menarik yang bikin kamu bengong 🤯',
    topics: ['facts'], postMin: 2, postMax: 4, interactMin: 6, interactMax: 18,
  },
  {
    name: 'Kak Sella', username: 'kaksella', avatar: null,
    bio: 'Self-development & mental health 🌱 | Yuk tumbuh bareng!',
    topics: ['life', 'quotes'], postMin: 2, postMax: 5, interactMin: 5, interactMax: 15,
  },
  {
    name: 'Entertain ID', username: 'entertainid', avatar: null,
    bio: 'Hiburan, seleb, dan lifestyle terkini 🎭 | Stay updated!',
    topics: ['entertainment'], postMin: 2, postMax: 5, interactMin: 6, interactMax: 16,
  },
  {
    name: 'dr. Mira Psikolog', username: 'drmira.psikolog', avatar: null,
    bio: 'Psikolog klinis 🧘 | Mental health awareness | DM untuk konsultasi',
    topics: ['life', 'health'], postMin: 1, postMax: 3, interactMin: 4, interactMax: 12,
  },
  {
    name: 'Ekonomi Rakyat', username: 'ekonomirakyat', avatar: null,
    bio: 'Edukasi keuangan & ekonomi untuk semua 💰 | Yuk melek finansial!',
    topics: ['economy', 'finance'], postMin: 2, postMax: 4, interactMin: 5, interactMax: 14,
  },
  {
    name: 'Alam Nusantara', username: 'alamnusantara', avatar: null,
    bio: 'Kecantikan alam Indonesia & lingkungan hidup 🌿 | Love our planet',
    topics: ['environment', 'nature'], postMin: 1, postMax: 3, interactMin: 4, interactMax: 10,
  },
  {
    name: 'Layar Perak ID', username: 'layarperakid', avatar: null,
    bio: '🎬 Pecinta film & serial | Review, rekomendasi, dan berita industri perfilman terkini',
    topics: ['film', 'entertainment'], postMin: 3, postMax: 6, interactMin: 5, interactMax: 14,
  },
  {
    name: 'Bonek Sejati', username: 'boneksejati', avatar: null,
    bio: '💚 Hidup Persebaya! | Berita, hasil, dan update terkini Persebaya Surabaya 🐊 | Bajul Ijo Forever',
    topics: ['persebaya'], postMin: 4, postMax: 8, interactMin: 6, interactMax: 16,
  },

  // ✅ Bot khusus berita Surabaya
  {
    name: 'Warta Surabaya', username: 'wartasurabaya', avatar: null,
    bio: '🏙️ Berita terkini seputar Surabaya & Jawa Timur | Untuk warga Surabaya, dari Surabaya',
    topics: ['surabaya'], postMin: 4, postMax: 8, interactMin: 5, interactMax: 14,
  },

  // Government bot
  {
    name: 'Info Pemerintah RI', username: 'infopemerintahri', avatar: null,
    bio: '🇮🇩 Informasi resmi kebijakan dan program pemerintah Indonesia | Akun Informasi Publik',
    topics: ['government', 'news'], postMin: 1, postMax: 1, interactMin: 2, interactMax: 5,
  },
];

// ─── BOT NAME POOL ────────────────────────────────────────────────────────────

const BOT_NAME_POOL = [
  { name: 'Andi Berita',    prefix: 'andiberita',    topics: ['news'],                   bio: 'Pecinta berita dan jurnalisme warga 📡' },
  { name: 'Sari Quotes',    prefix: 'sariquotes',    topics: ['quotes', 'motivational'], bio: 'Kumpulan kata bijak untuk harimu ✨' },
  { name: 'Budi Teknologi', prefix: 'buditeknologi', topics: ['tech'],                   bio: 'Ngobrolin teknologi sehari-hari 🤖' },
  { name: 'Nurul Hikmah',   prefix: 'nurulhikmah',  topics: ['islamic'],                bio: 'Mutiara hikmah dan tausiyah harian 🌙' },
  { name: 'Reza Life',      prefix: 'rezalife',      topics: ['life', 'quotes'],         bio: 'Sharing soal hidup, karir & kebahagiaan 🌈' },
  { name: 'Tio Fakta',      prefix: 'tiofakta',      topics: ['facts'],                  bio: 'Koleksi fakta mengejutkan dari seluruh dunia 🌍' },
  { name: 'Maya Sehat',     prefix: 'mayasehat',     topics: ['health', 'life'],         bio: 'Tips hidup sehat fisik dan mental 💪' },
  { name: 'Galih Viral',    prefix: 'galihviral',    topics: ['entertainment', 'film'],  bio: 'Konten hiburan & film viral yang wajib kamu lihat 🔥' },
  { name: 'Dewi Edukasi',   prefix: 'dewiedukasi',   topics: ['education', 'life'],      bio: 'Edukasi seru dan bermanfaat untuk semua 📚' },
  { name: 'Hendra Bisnis',  prefix: 'hendrabisnis',  topics: ['economy', 'finance'],     bio: 'Tips bisnis dan investasi untuk pemula 💼' },
  { name: 'Putri Alam',     prefix: 'putrialam',     topics: ['environment', 'nature'],  bio: 'Pecinta alam dan lingkungan hidup 🌿' },
  { name: 'Arif Kuliner',   prefix: 'arifkuliner',   topics: ['food', 'life'],           bio: 'Eksplorasi kuliner Nusantara dan dunia 🍜' },
  { name: 'Lina Budaya',    prefix: 'linabudaya',    topics: ['culture', 'news'],        bio: 'Merawat budaya dan tradisi Indonesia 🎭' },
  { name: 'Yoga Olahraga',  prefix: 'yogaolahraga',  topics: ['sports', 'health'],       bio: 'Semangat olahraga dan gaya hidup aktif ⚽' },
  { name: 'Citra Seni',     prefix: 'citraseni',     topics: ['art', 'entertainment'],   bio: 'Apresiasi seni, musik, dan kreativitas 🎨' },
  { name: 'Sinema Kita',    prefix: 'sinemakita',    topics: ['film'],                   bio: 'Review & rekomendasi film untuk semua selera 🎬' },
  { name: 'Kabar Surabaya', prefix: 'kabarsurabaya', topics: ['surabaya'],               bio: 'Info dan kabar terkini seputar Kota Pahlawan 🏙️' },
];

// ─── DUPLICATE DETECTION ──────────────────────────────────────────────────────

const recentContentHashes = new Set<string>();
const MAX_HASH_CACHE = 500;

const simpleHash = (content: string): string =>
  content.trim().toLowerCase().substring(0, 80);

const isContentDuplicate = (content: string): boolean =>
  recentContentHashes.has(simpleHash(content));

const markContentUsed = (content: string): void => {
  recentContentHashes.add(simpleHash(content));
  if (recentContentHashes.size > MAX_HASH_CACHE) {
    const first = recentContentHashes.values().next().value;
    if (first) recentContentHashes.delete(first);
  }
};

const isPostedBefore = async (sourceUrl: string | null): Promise<boolean> => {
  if (!sourceUrl || sourceUrl.trim() === '') return false;
  const result = await db.execute({
    sql:  `SELECT id FROM feed_posts WHERE source_url = ? LIMIT 1`,
    args: [a(sourceUrl)],
  });
  return result.rows.length > 0;
};

const isContentPostedBefore = async (content: string): Promise<boolean> => {
  const hash = simpleHash(content);
  const result = await db.execute({
    sql: `SELECT id FROM feed_posts
          WHERE is_bot_post = 1
            AND LOWER(SUBSTR(content, 1, 80)) = ?
            AND created_at > datetime('now', '-7 days')
          LIMIT 1`,
    args: [a(hash)],
  });
  return result.rows.length > 0;
};

// ─── INIT BOTS ────────────────────────────────────────────────────────────────

export const initBots = async (): Promise<void> => {
  logger.info('Bot: Initializing bots...');

  for (const template of BOT_TEMPLATES) {
    const cnt = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM bots WHERE is_active = 1', args: []
    });
    if (Number((cnt.rows[0] as any).count) >= MAX_BOTS) break;

    try {
      const existing = await db.execute({
        sql:  'SELECT id FROM social_profiles WHERE username = ?',
        args: [a(template.username)]
      });
      if (existing.rows.length > 0) continue;

      const botUserId = uuidv4();
      await db.execute({
        sql:  `INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)`,
        args: [a(botUserId), a(template.name), a(`${template.username}@bot.ambarya.app`), a('bot_no_login')]
      });
      await db.execute({
        sql:  `INSERT INTO social_profiles (id, user_id, username, display_name, bio, is_bot, bot_topics) VALUES (?, ?, ?, ?, ?, 1, ?)`,
        args: [a(uuidv4()), a(botUserId), a(template.username), a(template.name), a(template.bio), a(JSON.stringify(template.topics))]
      });
      await db.execute({
        sql:  `INSERT INTO bots (id, user_id, name, bio, topics, sources, post_frequency_min, post_frequency_max, interact_frequency_min, interact_frequency_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          a(uuidv4()), a(botUserId), a(template.name), a(template.bio),
          a(JSON.stringify(template.topics)), a('["rss","ai"]'),
          a(template.postMin), a(template.postMax),
          a(template.interactMin), a(template.interactMax),
        ]
      });
      logger.info('Bot: Created', { username: template.username });
    } catch (err) {
      logger.error('Bot: Failed to create', { username: template.username, err });
    }
  }

  await _preloadRecentHashes();
  logger.info('Bot: Init complete');
};

const _preloadRecentHashes = async (): Promise<void> => {
  try {
    const recentPosts = await db.execute({
      sql: `SELECT content FROM feed_posts
            WHERE is_bot_post = 1
              AND created_at > datetime('now', '-2 days')
            ORDER BY created_at DESC LIMIT 200`,
      args: [],
    });
    for (const row of recentPosts.rows as any[]) {
      if (row.content) markContentUsed(str(row.content));
    }
    logger.info(`Bot: Preloaded ${recentPosts.rows.length} recent hashes`);
  } catch (err) {
    logger.error('Bot: Failed to preload hashes', { err });
  }
};

// ─── AUTO-GROW BOTS ───────────────────────────────────────────────────────────

export const growBots = async (): Promise<void> => {
  const countResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM bots WHERE is_active = 1', args: []
  });
  const currentCount = Number((countResult.rows[0] as any).count);

  if (currentCount >= MAX_BOTS) {
    logger.info(`Bot: At max capacity (${currentCount}/${MAX_BOTS})`);
    return;
  }

  const toAdd = Math.min(randInt(1, 2), MAX_BOTS - currentCount);

  for (let i = 0; i < toAdd; i++) {
    const template = BOT_NAME_POOL[Math.floor(Math.random() * BOT_NAME_POOL.length)];
    const suffix   = randInt(1, 999);
    const username = `${template.prefix}${suffix}`;

    const existing = await db.execute({
      sql: 'SELECT id FROM social_profiles WHERE username = ?', args: [a(username)]
    });
    if (existing.rows.length > 0) continue;

    try {
      const botUserId = uuidv4();
      await db.execute({
        sql:  `INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)`,
        args: [a(botUserId), a(template.name), a(`${username}@bot.ambarya.app`), a('bot_no_login')]
      });
      await db.execute({
        sql:  `INSERT INTO social_profiles (id, user_id, username, display_name, bio, is_bot, bot_topics) VALUES (?, ?, ?, ?, ?, 1, ?)`,
        args: [a(uuidv4()), a(botUserId), a(username), a(template.name), a(template.bio), a(JSON.stringify(template.topics))]
      });
      await db.execute({
        sql:  `INSERT INTO bots (id, user_id, name, bio, topics, sources, post_frequency_min, post_frequency_max, interact_frequency_min, interact_frequency_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          a(uuidv4()), a(botUserId), a(template.name), a(template.bio),
          a(JSON.stringify(template.topics)), a('["rss","ai"]'),
          a(randInt(1, 3)), a(randInt(4, 7)), a(randInt(3, 8)), a(randInt(10, 20)),
        ]
      });
      logger.info('Bot: Auto-grew', { username, count: currentCount + i + 1 });
    } catch (err) {
      logger.error('Bot: Auto-grow failed', { username, err });
    }
  }
};

// ─── GOVERNMENT BOT POST (1x per jam) ────────────────────────────────────────

export const runGovernmentBotPost = async (): Promise<void> => {
  const govBot = await db.execute({
    sql: `SELECT b.*, sp.user_id FROM bots b
          JOIN social_profiles sp ON sp.user_id = b.user_id
          WHERE sp.username = 'infopemerintahri' AND b.is_active = 1`,
    args: []
  });

  if (govBot.rows.length === 0) return;
  const bot = govBot.rows[0] as any;

  const content = await fetchContentByTopic('government');
  if (!content) return;

  if (isContentDuplicate(content.content)) {
    logger.info('Gov Bot: Skipped (memory duplicate)');
    return;
  }
  if (await isPostedBefore(content.sourceUrl || null)) {
    logger.info('Gov Bot: Skipped (source_url already posted)');
    markContentUsed(content.content);
    return;
  }
  if (await isContentPostedBefore(content.content)) {
    logger.info('Gov Bot: Skipped (content already posted)');
    markContentUsed(content.content);
    return;
  }

  markContentUsed(content.content);

  const postId    = uuidv4();
  const now       = new Date().toISOString();
  const mediaJson = content.imageUrl
    ? JSON.stringify([{ url: content.imageUrl, type: 'image', name: 'thumbnail' }])
    : '[]';

  await db.execute({
    sql:  `INSERT INTO feed_posts (id, user_id, content, media, visibility, is_bot_post, source_url, source_name, created_at)
           VALUES (?, ?, ?, ?, 'public', 1, ?, ?, ?)`,
    args: [a(postId), a(str(bot.user_id)), a(content.content), a(mediaJson), a(content.sourceUrl || null), a(content.sourceName || null), a(now)]
  });

  logger.info('Gov Bot: Posted', { postId, hasImage: !!content.imageUrl });
};

// ─── BOT POST (regular) ───────────────────────────────────────────────────────

export const runBotPosts = async (): Promise<void> => {
  logger.info('Bot: Running bot posts...');

  const bots = await db.execute({
    sql: `SELECT b.*, sp.user_id FROM bots b
          JOIN social_profiles sp ON sp.user_id = b.user_id
          WHERE b.is_active = 1 AND sp.username != 'infopemerintahri'`,
    args: []
  });

  await _preloadRecentHashes();

  for (const bot of bots.rows as any[]) {
    try {
      const activationChance = Number(bot.post_frequency_max) / 10;
      if (Math.random() > activationChance) continue;

      const postCount = randInt(1, Math.min(Number(bot.post_frequency_max), 3));
      const topics: string[] = JSON.parse(str(bot.topics) || '["quotes"]');

      for (let i = 0; i < postCount; i++) {
        await randomDelay(30_000, 300_000);

        const topic    = topics[Math.floor(Math.random() * topics.length)];
        let content    = null;
        let imageUrl   = null;
        let sourceName = null;
        let sourceUrl  = null;

        for (let attempt = 0; attempt < 5; attempt++) {
          const fetched = await fetchContentByTopic(topic);
          if (!fetched) break;

          if (isContentDuplicate(fetched.content)) continue;
          if (await isPostedBefore(fetched.sourceUrl || null)) {
            markContentUsed(fetched.content);
            continue;
          }
          if (await isContentPostedBefore(fetched.content)) {
            markContentUsed(fetched.content);
            continue;
          }

          content    = fetched.content;
          imageUrl   = fetched.imageUrl   || null;
          sourceName = fetched.sourceName || null;
          sourceUrl  = fetched.sourceUrl  || null;
          break;
        }

        if (!content) {
          logger.info('Bot: No fresh content found', { bot: bot.name, topic });
          continue;
        }

        markContentUsed(content);

        const postId    = uuidv4();
        const now       = new Date().toISOString();
        const mediaJson = imageUrl
          ? JSON.stringify([{ url: imageUrl, type: 'image', name: 'thumbnail' }])
          : '[]';

        await db.execute({
          sql:  `INSERT INTO feed_posts (id, user_id, content, media, visibility, is_bot_post, source_url, source_name, created_at)
                 VALUES (?, ?, ?, ?, 'public', 1, ?, ?, ?)`,
          args: [a(postId), a(str(bot.user_id)), a(content), a(mediaJson), a(sourceUrl), a(sourceName), a(now)]
        });

        logger.info('Bot: Posted', { bot: bot.name, topic, hasImage: !!imageUrl });
      }

      await db.execute({
        sql:  'UPDATE bots SET last_post_at = ? WHERE id = ?',
        args: [a(new Date().toISOString()), a(str(bot.id))]
      });
    } catch (err) {
      logger.error('Bot: Post failed', { bot: bot.name, err });
    }
  }
};

// ─── BOT INTERACT ─────────────────────────────────────────────────────────────

export const runBotInteractions = async (): Promise<void> => {
  const bots = await db.execute({
    sql: `SELECT b.*, sp.user_id FROM bots b
          JOIN social_profiles sp ON sp.user_id = b.user_id
          WHERE b.is_active = 1`,
    args: []
  });

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
      const activationChance = Number(bot.interact_frequency_max) / 25;
      if (Math.random() > Math.min(activationChance, 0.7)) continue;

      const interactCount = randInt(
        Math.ceil(Number(bot.interact_frequency_min) / 2),
        Math.min(Number(bot.interact_frequency_max), 8)
      );
      const shuffled = [...recentPosts.rows].sort(() => Math.random() - 0.5);
      const targets  = shuffled.slice(0, Math.min(interactCount, shuffled.length));

      for (const post of targets as any[]) {
        await randomDelay(5_000, 60_000);
        if (Math.random() < 0.65) {
          await _botLike(str(bot.user_id), str(post.id));
        } else {
          await _botComment(str(bot.user_id), str(post.id));
        }
      }

      await db.execute({
        sql:  'UPDATE bots SET last_interact_at = ? WHERE id = ?',
        args: [a(new Date().toISOString()), a(str(bot.id))]
      });
    } catch (err) {
      logger.error('Bot: Interact failed', { bot: bot.name, err });
    }
  }
};

const _botLike = async (botUserId: string, postId: string): Promise<void> => {
  const existing = await db.execute({
    sql:  'SELECT id FROM reactions WHERE user_id = ? AND post_id = ?',
    args: [a(botUserId), a(postId)]
  });
  if (existing.rows.length > 0) return;
  await db.execute({
    sql:  'INSERT INTO reactions (id, user_id, post_id, type) VALUES (?, ?, ?, ?)',
    args: [a(uuidv4()), a(botUserId), a(postId), a('like')]
  });
};

const _botComment = async (botUserId: string, postId: string): Promise<void> => {
  const existing = await db.execute({
    sql:  'SELECT id FROM comments WHERE user_id = ? AND post_id = ? AND parent_id IS NULL',
    args: [a(botUserId), a(postId)]
  });
  if (existing.rows.length > 0) return;

  const comment = getRandomComment();
  const now     = new Date().toISOString();
  await db.execute({
    sql:  `INSERT INTO comments (id, user_id, post_id, content, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: [a(uuidv4()), a(botUserId), a(postId), a(comment), a(now)]
  });

  const post        = await db.execute({
    sql: 'SELECT user_id FROM feed_posts WHERE id = ?', args: [a(postId)]
  });
  const postOwnerId = post.rows[0] ? str(post.rows[0].user_id) : null;
  if (postOwnerId && postOwnerId !== botUserId) {
    await db.execute({
      sql:  `INSERT INTO social_notifications (id, user_id, actor_id, type, post_id) VALUES (?, ?, ?, 'comment', ?)`,
      args: [a(uuidv4()), a(postOwnerId), a(botUserId), a(postId)]
    });
  }
};