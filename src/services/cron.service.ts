// backend/src/services/cron.service.ts

import cron from 'node-cron';
import db from '../db/database';
import { getDailyReflection } from './ai.service';
import { cacheSet, cacheDelPattern } from './cache.service';
import { initBots, runBotPosts, runBotInteractions, runGovernmentBotPost, growBots } from './bot.service';
import { deleteFromCloudinary } from './cloudinary.service';
import logger from './logger.service';

// ─── RANDOM SCHEDULE HELPER ───────────────────────────────────────────────────

const scheduleRandom = (
  label: string,
  intervalMinutes: number,
  jitterMinutes: number,
  fn: () => Promise<void>
) => {
  const firstDelay = Math.random() * jitterMinutes * 60 * 1000;
  setTimeout(async () => {
    logger.info(`Cron: ${label} - first run`);
    try { await fn(); } catch (err) { logger.error(`Cron: ${label} failed`, { err }); }
    const loop = async () => {
      const jitter = (Math.random() * 2 - 1) * jitterMinutes * 60 * 1000;
      const delay  = Math.max((intervalMinutes * 60 * 1000) + jitter, 60_000);
      setTimeout(async () => {
        logger.info(`Cron: ${label} - run`);
        try { await fn(); } catch (err) { logger.error(`Cron: ${label} failed`, { err }); }
        loop();
      }, delay);
    };
    loop();
  }, firstDelay);
};

// ─── GOVERNMENT BOT: 1x per jam, waktu random ────────────────────────────────

const startGovernmentBotSchedule = () => {
  // ✅ Cukup 1 scheduler — jalan tiap ~60 menit dengan jitter ±10 menit
  // Sehingga posting antara 50-70 menit sekali, tidak spam
  scheduleRandom('Gov Bot Post', 60, 10, runGovernmentBotPost);
  logger.info('Cron: Government bot scheduled (1x/hour, random timing)');
};

// ─── AUTO-DELETE OLD BOT POSTS + CLOUDINARY CLEANUP ──────────────────────────

const deleteOldBotPosts = async (): Promise<void> => {
  logger.info('Cron: Deleting old bot posts...');

  try {
    // Hanya hapus post bot yang sudah > 2 hari
    // DAN tidak ada komentar atau reaction dari user (non-bot)
    const oldPosts = await db.execute({
      sql: `SELECT id, media FROM feed_posts
            WHERE is_bot_post = 1
              AND created_at < datetime('now', '-2 days')
              AND id NOT IN (
                SELECT DISTINCT post_id FROM comments
                WHERE user_id IN (
                  SELECT user_id FROM social_profiles WHERE is_bot = 0
                )
              )
              AND id NOT IN (
                SELECT DISTINCT post_id FROM reactions
                WHERE user_id IN (
                  SELECT user_id FROM social_profiles WHERE is_bot = 0
                )
              )`,
      args: [],
    });

    if (oldPosts.rows.length === 0) {
      logger.info('Cron: No old bot posts to delete');
      return;
    }

    logger.info(`Cron: Found ${oldPosts.rows.length} old bot posts to delete`);

    // Kumpulkan public_id Cloudinary
    const publicIds: string[] = [];
    for (const row of oldPosts.rows as any[]) {
      try {
        const media: any[] = JSON.parse(row.media || '[]');
        for (const item of media) {
          const url = item.url as string | undefined;
          if (!url) continue;
          const publicId = _extractPublicId(url);
          if (publicId) publicIds.push(publicId);
        }
      } catch (_) {}
    }

    // Hapus dari Cloudinary (best-effort)
    if (publicIds.length > 0) {
      logger.info(`Cron: Deleting ${publicIds.length} Cloudinary files...`);
      const results = await Promise.allSettled(
        publicIds.map(id => deleteFromCloudinary(id))
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) logger.warn(`Cron: ${failed} Cloudinary deletions failed (non-fatal)`);
      logger.info(`Cron: Cloudinary cleanup done (${publicIds.length - failed}/${publicIds.length} deleted)`);
    }

    // Hapus dari DB secara batch
    const postIds = (oldPosts.rows as any[]).map(r => r.id as string);
    const BATCH   = 100;

    for (let i = 0; i < postIds.length; i += BATCH) {
      const batch        = postIds.slice(i, i + BATCH);
      const placeholders = batch.map(() => '?').join(',');

      // Hapus komentar (sudah dipastikan tidak ada komentar user di query atas)
      await db.execute({
        sql:  `DELETE FROM comments WHERE post_id IN (${placeholders})`,
        args: batch,
      });

      // Hapus hanya reactions dari bot
      await db.execute({
        sql:  `DELETE FROM reactions
               WHERE post_id IN (${placeholders})
                 AND user_id IN (
                   SELECT user_id FROM social_profiles WHERE is_bot = 1
                 )`,
        args: batch,
      });

      // Notifikasi ke user TIDAK dihapus

      // Hapus post
      await db.execute({
        sql:  `DELETE FROM feed_posts WHERE id IN (${placeholders})`,
        args: batch,
      });
    }

    logger.info(`Cron: Deleted ${postIds.length} old bot posts from DB`);
  } catch (err) {
    logger.error('Cron: Auto-delete failed', { err });
  }
};

const _extractPublicId = (url: string): string | null => {
  try {
    const parts = url.split('/upload/');
    if (parts.length < 2) return null;
    const withoutVersion = parts[1].replace(/^v\d+\//, '');
    return withoutVersion.replace(/\.[^/.]+$/, '');
  } catch {
    return null;
  }
};

const scheduleAutoDelete = () => {
  const randomHour   = Math.floor(Math.random() * 4) + 1;
  const randomMinute = Math.floor(Math.random() * 60);
  logger.info(`Cron: Auto-delete scheduled at ${randomHour}:${String(randomMinute).padStart(2, '0')} WIB`);
  cron.schedule(`${randomMinute} ${randomHour} * * *`, deleteOldBotPosts, { timezone: 'Asia/Jakarta' });
};

// ─── INIT ALL CRON JOBS ───────────────────────────────────────────────────────

export const initCronJobs = async () => {

  try { await initBots(); } catch (err) { logger.error('Failed to init bots', { err }); }

  // ── Fixed schedules ──────────────────────────────────

  cron.schedule('1 0 * * *', async () => {
    await cacheDelPattern('analytics:*');
  }, { timezone: 'Asia/Jakarta' });

  cron.schedule('0 7 * * *', async () => {
    const today = new Date();
    const mmdd  = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const users = await db.execute({
      sql: `SELECT id FROM users WHERE email NOT LIKE '%@bot.ambarya.app'`, args: []
    });
    for (const user of users.rows as any[]) {
      const entries = await db.execute({
        sql: `SELECT * FROM entries
              WHERE user_id = ?
                AND strftime('%m-%d', created_at) = ?
                AND strftime('%Y', created_at) != strftime('%Y', 'now')
              ORDER BY created_at DESC`,
        args: [user.id, mmdd]
      });
      if (entries.rows.length > 0) {
        const parsed = entries.rows.map((e: any) => ({
          ...e,
          tags:  JSON.parse(e.tags  || '[]'),
          media: JSON.parse(e.media || '[]'),
        }));
        await cacheSet(`on-this-day:${user.id}:${mmdd}`, parsed, 60 * 60 * 20);
      }
    }
  }, { timezone: 'Asia/Jakarta' });

  cron.schedule('0 21 * * *', async () => {
    const today = new Date().toISOString().split('T')[0];
    const users = await db.execute({
      sql: `SELECT id FROM users WHERE email NOT LIKE '%@bot.ambarya.app'`, args: []
    });
    for (const user of users.rows as any[]) {
      const entries = await db.execute({
        sql: `SELECT * FROM entries
              WHERE user_id = ?
                AND strftime('%Y-%m-%d', created_at) = ?
              ORDER BY created_at ASC`,
        args: [user.id, today]
      });
      if (entries.rows.length > 0) {
        try {
          const reflection = await getDailyReflection(entries.rows);
          await cacheSet(`daily-reflection:${user.id}:${today}`, reflection, 60 * 60 * 24);
        } catch (err) {
          logger.error('Cron: Reflection failed', { userId: user.id, err });
        }
      }
    }
  }, { timezone: 'Asia/Jakarta' });

  cron.schedule('0 2 * * 0', async () => {
    await db.execute({
      sql:  `DELETE FROM refresh_tokens WHERE expires_at < datetime('now') OR revoked = 1`,
      args: []
    });
  }, { timezone: 'Asia/Jakarta' });

  cron.schedule('30 0 1 1 *', async () => {
    const lastYear = new Date().getFullYear() - 1;
    const users    = await db.execute({
      sql: `SELECT id FROM users WHERE email NOT LIKE '%@bot.ambarya.app'`, args: []
    });
    for (const user of users.rows as any[]) {
      const result  = await db.execute({
        sql:  `SELECT * FROM entries WHERE user_id = ? AND strftime('%Y', created_at) = ?`,
        args: [user.id, String(lastYear)]
      });
      const entries = result.rows as any[];
      if (entries.length === 0) continue;

      const longest = entries.reduce((a: any, b: any) =>
        ((b.content?.length || 0) > (a.content?.length || 0) ? b : a));
      const moodCount: Record<string, number> = {};
      entries.forEach((e: any) => {
        if (e.mood_label) moodCount[e.mood_label] = (moodCount[e.mood_label] || 0) + 1;
      });
      const topMood  = Object.entries(moodCount).sort((a, b) => b[1] - a[1])[0];
      const words: Record<string, number> = {};
      entries.forEach((e: any) => {
        (e.content || '').toLowerCase().split(/\s+/).forEach((w: string) => {
          if (w.length > 3) words[w] = (words[w] || 0) + 1;
        });
      });
      const topWords = Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 20);
      const tagCount: Record<string, number> = {};
      entries.forEach((e: any) => {
        JSON.parse(e.tags || '[]').forEach((t: string) => {
          tagCount[t] = (tagCount[t] || 0) + 1;
        });
      });
      const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

      await cacheSet(`year-review:${user.id}:${lastYear}`, {
        year:         lastYear,
        totalEntries: entries.length,
        longestEntry: { id: longest.id, title: longest.title, length: longest.content?.length },
        topMood:      topMood ? { label: topMood[0], count: topMood[1] } : null,
        topWords, topTags,
        firstEntry:   entries[entries.length - 1],
        lastEntry:    entries[0],
      }, 60 * 60 * 24 * 365);
    }
  }, { timezone: 'Asia/Jakarta' });

  // ── Random schedules ──────────────────────────────────

  scheduleAutoDelete();
  scheduleRandom('Bot Posts',        90,  30, runBotPosts);
  scheduleRandom('Bot Interactions', 45,  15, runBotInteractions);
  scheduleRandom('Bot Grow',        360,  60, growBots);
  startGovernmentBotSchedule();

  logger.info('✅ All cron jobs initialized');
};