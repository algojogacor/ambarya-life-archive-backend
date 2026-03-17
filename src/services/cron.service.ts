// backend/src/services/cron.service.ts

import cron from 'node-cron';
import db from '../db/database';
import { getDailyReflection } from './ai.service';
import { cacheSet, cacheDelPattern } from './cache.service';
import { initBots, runBotPosts, runBotInteractions, runGovernmentBotPost, growBots } from './bot.service';
import logger from './logger.service';

// ─── RANDOM SCHEDULE HELPER ───────────────────────────────────────────────────

const scheduleRandom = (label: string, intervalMinutes: number, jitterMinutes: number, fn: () => Promise<void>) => {
  const firstDelay = Math.random() * jitterMinutes * 60 * 1000;
  setTimeout(async () => {
    logger.info(`Cron: ${label} - first run`);
    try { await fn(); } catch (err) { logger.error(`Cron: ${label} failed`, { err }); }
    const loop = async () => {
      const jitter = (Math.random() * 2 - 1) * jitterMinutes * 60 * 1000;
      const delay = Math.max((intervalMinutes * 60 * 1000) + jitter, 60_000);
      setTimeout(async () => {
        logger.info(`Cron: ${label} - run`);
        try { await fn(); } catch (err) { logger.error(`Cron: ${label} failed`, { err }); }
        loop();
      }, delay);
    };
    loop();
  }, firstDelay);
};

// ─── GOVERNMENT BOT: 6x per jam, waktu random ────────────────────────────────

const startGovernmentBotSchedule = () => {
  // Jadwalkan 6 posting per jam dengan waktu random
  // Rata-rata 1 post tiap 10 menit, jitter ±4 menit → antara 6-14 menit per post
  scheduleRandom('Gov Bot Post 1', 10, 4, runGovernmentBotPost);

  // Mulai 6 scheduler dengan delay awal berbeda agar tersebar dalam 1 jam
  setTimeout(() => scheduleRandom('Gov Bot Post 2', 10, 4, runGovernmentBotPost), 10 * 60 * 1000);
  setTimeout(() => scheduleRandom('Gov Bot Post 3', 10, 4, runGovernmentBotPost), 20 * 60 * 1000);
  setTimeout(() => scheduleRandom('Gov Bot Post 4', 10, 4, runGovernmentBotPost), 30 * 60 * 1000);
  setTimeout(() => scheduleRandom('Gov Bot Post 5', 10, 4, runGovernmentBotPost), 40 * 60 * 1000);
  setTimeout(() => scheduleRandom('Gov Bot Post 6', 10, 4, runGovernmentBotPost), 50 * 60 * 1000);

  logger.info('Cron: Government bot scheduled (6x/hour, random timing)');
};

// ─── AUTO-DELETE OLD BOT POSTS ────────────────────────────────────────────────

const scheduleAutoDelete = () => {
  const randomHour = Math.floor(Math.random() * 4) + 1;
  const randomMinute = Math.floor(Math.random() * 60);
  logger.info(`Cron: Auto-delete scheduled at ${randomHour}:${String(randomMinute).padStart(2, '0')} WIB`);

  cron.schedule(`${randomMinute} ${randomHour} * * *`, async () => {
    logger.info('Cron: Deleting old bot posts...');
    try {
      await db.execute({ sql: `DELETE FROM comments WHERE post_id IN (SELECT id FROM feed_posts WHERE is_bot_post = 1 AND created_at < datetime('now', '-2 days'))`, args: [] });
      await db.execute({ sql: `DELETE FROM reactions WHERE post_id IN (SELECT id FROM feed_posts WHERE is_bot_post = 1 AND created_at < datetime('now', '-2 days'))`, args: [] });
      const result = await db.execute({ sql: `DELETE FROM feed_posts WHERE is_bot_post = 1 AND created_at < datetime('now', '-2 days')`, args: [] });
      logger.info('Cron: Old bot posts deleted', { rowsAffected: result.rowsAffected });
    } catch (err) { logger.error('Cron: Auto-delete failed', { err }); }
  }, { timezone: 'Asia/Jakarta' });
};

export const initCronJobs = async () => {

  // Init bots
  try { await initBots(); } catch (err) { logger.error('Failed to init bots', { err }); }

  // ─── Fixed schedules ──────────────────────────────────

  cron.schedule('1 0 * * *', async () => { await cacheDelPattern('analytics:*'); }, { timezone: 'Asia/Jakarta' });

  cron.schedule('0 7 * * *', async () => {
    const today = new Date();
    const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const users = await db.execute({ sql: `SELECT id FROM users WHERE email NOT LIKE '%@bot.ambarya.app'`, args: [] });
    for (const user of users.rows as any[]) {
      const entries = await db.execute({
        sql: `SELECT * FROM entries WHERE user_id = ? AND strftime('%m-%d', created_at) = ? AND strftime('%Y', created_at) != strftime('%Y', 'now') ORDER BY created_at DESC`,
        args: [user.id, mmdd]
      });
      if (entries.rows.length > 0) {
        const parsed = entries.rows.map((e: any) => ({ ...e, tags: JSON.parse(e.tags || '[]'), media: JSON.parse(e.media || '[]') }));
        await cacheSet(`on-this-day:${user.id}:${mmdd}`, parsed, 60 * 60 * 20);
      }
    }
  }, { timezone: 'Asia/Jakarta' });

  cron.schedule('0 21 * * *', async () => {
    const today = new Date().toISOString().split('T')[0];
    const users = await db.execute({ sql: `SELECT id FROM users WHERE email NOT LIKE '%@bot.ambarya.app'`, args: [] });
    for (const user of users.rows as any[]) {
      const entries = await db.execute({ sql: `SELECT * FROM entries WHERE user_id = ? AND strftime('%Y-%m-%d', created_at) = ? ORDER BY created_at ASC`, args: [user.id, today] });
      if (entries.rows.length > 0) {
        try {
          const reflection = await getDailyReflection(entries.rows);
          await cacheSet(`daily-reflection:${user.id}:${today}`, reflection, 60 * 60 * 24);
        } catch (err) { logger.error('Cron: Reflection failed', { userId: user.id, err }); }
      }
    }
  }, { timezone: 'Asia/Jakarta' });

  cron.schedule('0 2 * * 0', async () => {
    await db.execute({ sql: `DELETE FROM refresh_tokens WHERE expires_at < datetime('now') OR revoked = 1`, args: [] });
  }, { timezone: 'Asia/Jakarta' });

  cron.schedule('30 0 1 1 *', async () => {
    const lastYear = new Date().getFullYear() - 1;
    const users = await db.execute({ sql: `SELECT id FROM users WHERE email NOT LIKE '%@bot.ambarya.app'`, args: [] });
    for (const user of users.rows as any[]) {
      const result = await db.execute({ sql: `SELECT * FROM entries WHERE user_id = ? AND strftime('%Y', created_at) = ?`, args: [user.id, String(lastYear)] });
      const entries = result.rows as any[];
      if (entries.length === 0) continue;
      const longest = entries.reduce((a: any, b: any) => ((b.content?.length || 0) > (a.content?.length || 0) ? b : a));
      const moodCount: Record<string, number> = {};
      entries.forEach((e: any) => { if (e.mood_label) moodCount[e.mood_label] = (moodCount[e.mood_label] || 0) + 1; });
      const topMood = Object.entries(moodCount).sort((a, b) => b[1] - a[1])[0];
      const words: Record<string, number> = {};
      entries.forEach((e: any) => { (e.content || '').toLowerCase().split(/\s+/).forEach((w: string) => { if (w.length > 3) words[w] = (words[w] || 0) + 1; }); });
      const topWords = Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 20);
      const tagCount: Record<string, number> = {};
      entries.forEach((e: any) => { JSON.parse(e.tags || '[]').forEach((t: string) => { tagCount[t] = (tagCount[t] || 0) + 1; }); });
      const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
      await cacheSet(`year-review:${user.id}:${lastYear}`, {
        year: lastYear, totalEntries: entries.length,
        longestEntry: { id: longest.id, title: longest.title, length: longest.content?.length },
        topMood: topMood ? { label: topMood[0], count: topMood[1] } : null,
        topWords, topTags, firstEntry: entries[entries.length - 1], lastEntry: entries[0],
      }, 60 * 60 * 24 * 365);
    }
  }, { timezone: 'Asia/Jakarta' });

  // ─── Random schedules ─────────────────────────────────

  scheduleAutoDelete();

  // Regular bot posts: 60-120 menit sekali
  scheduleRandom('Bot Posts', 90, 30, runBotPosts);

  // Bot interaksi: 30-60 menit sekali
  scheduleRandom('Bot Interactions', 45, 15, runBotInteractions);

  // Bot grow: ~6 jam sekali (max 50)
  scheduleRandom('Bot Grow', 360, 60, growBots);

  // Government bot: 6x per jam, waktu random
  startGovernmentBotSchedule();

  logger.info('✅ All cron jobs initialized');
};