import cron from 'node-cron';
import db from '../db/database';
import { getDailyReflection } from './ai.service';
import { cacheSet, cacheDelPattern } from './cache.service';
import logger from './logger.service';

export const initCronJobs = () => {
  // ─── Daily: Invalidate analytics cache jam 00:01 ─────
  cron.schedule('1 0 * * *', async () => {
    logger.info('Cron: Invalidating analytics cache');
    await cacheDelPattern('analytics:*');
  }, { timezone: 'Asia/Jakarta' });

  // ─── Daily: Pre-generate On This Day jam 07:00 ───────
  cron.schedule('0 7 * * *', async () => {
    logger.info('Cron: Pre-generating On This Day');
    const today = new Date();
    const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const usersResult = await db.execute({ sql: 'SELECT id FROM users', args: [] });

    for (const user of usersResult.rows as any[]) {
      const entries = await db.execute({
        sql: `SELECT * FROM entries WHERE user_id = ? AND strftime('%m-%d', created_at) = ? AND strftime('%Y', created_at) != strftime('%Y', 'now') ORDER BY created_at DESC`,
        args: [user.id, mmdd]
      });

      if (entries.rows.length > 0) {
        const parsed = entries.rows.map((e: any) => ({
          ...e,
          tags: JSON.parse(e.tags || '[]'),
          media: JSON.parse(e.media || '[]'),
        }));
        await cacheSet(`on-this-day:${user.id}:${mmdd}`, parsed, 60 * 60 * 20);
        logger.info('Cron: On This Day cached', { userId: user.id, count: entries.rows.length });
      }
    }
  }, { timezone: 'Asia/Jakarta' });

  // ─── Daily: Generate AI reflection jam 21:00 ─────────
  cron.schedule('0 21 * * *', async () => {
    logger.info('Cron: Generating daily AI reflections');
    const today = new Date().toISOString().split('T')[0];
    const usersResult = await db.execute({ sql: 'SELECT id FROM users', args: [] });

    for (const user of usersResult.rows as any[]) {
      const entries = await db.execute({
        sql: `SELECT * FROM entries WHERE user_id = ? AND strftime('%Y-%m-%d', created_at) = ? ORDER BY created_at ASC`,
        args: [user.id, today]
      });

      if (entries.rows.length > 0) {
        try {
          const reflection = await getDailyReflection(entries.rows);
          await cacheSet(`daily-reflection:${user.id}:${today}`, reflection, 60 * 60 * 24);
          logger.info('Cron: Daily reflection generated', { userId: user.id });
        } catch (err) {
          logger.error('Cron: Failed to generate reflection', { userId: user.id, err });
        }
      }
    }
  }, { timezone: 'Asia/Jakarta' });

  // ─── Weekly: Cleanup expired refresh tokens ───────────
  cron.schedule('0 2 * * 0', async () => {
    logger.info('Cron: Cleaning up expired refresh tokens');
    await db.execute({
      sql: `DELETE FROM refresh_tokens WHERE expires_at < datetime('now') OR revoked = 1`,
      args: []
    });
    logger.info('Cron: Refresh tokens cleanup done');
  }, { timezone: 'Asia/Jakarta' });

  // ─── Yearly: Pre-generate Year in Review (1 Jan 00:30) ─
  cron.schedule('30 0 1 1 *', async () => {
    const lastYear = new Date().getFullYear() - 1;
    logger.info(`Cron: Pre-generating Year in Review ${lastYear}`);
    const usersResult = await db.execute({ sql: 'SELECT id FROM users', args: [] });

    for (const user of usersResult.rows as any[]) {
      const result = await db.execute({
        sql: `SELECT * FROM entries WHERE user_id = ? AND strftime('%Y', created_at) = ?`,
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
      const topMood = Object.entries(moodCount).sort((a, b) => b[1] - a[1])[0];

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

      const review = {
        year: lastYear, totalEntries: entries.length,
        longestEntry: { id: longest.id, title: longest.title, length: longest.content?.length },
        topMood: topMood ? { label: topMood[0], count: topMood[1] } : null,
        topWords, topTags,
        firstEntry: entries[entries.length - 1],
        lastEntry: entries[0],
      };

      await cacheSet(`year-review:${user.id}:${lastYear}`, review, 60 * 60 * 24 * 365);
      logger.info('Cron: Year in Review cached', { userId: user.id, year: lastYear });
    }
  }, { timezone: 'Asia/Jakarta' });

  logger.info('✅ All cron jobs initialized');
};