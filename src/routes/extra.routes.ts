import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import db from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import { generateLifeAlbumPDF } from '../services/pdf.service';
import { cacheGet, cacheSet } from '../services/cache.service';

const router = Router();
router.use(authenticate);

// ─── MOOD LOG ───────────────────────────────────────────
router.post('/moods', async (req, res) => {
  const userId = (req as any).user.id;
  const { mood, mood_label, note } = req.body;
  const id = uuidv4();
  await db.execute({
    sql: 'INSERT INTO moods (id, user_id, mood, mood_label, note) VALUES (?, ?, ?, ?, ?)',
    args: [id, userId, mood, mood_label, note || null]
  });
  res.status(201).json({ message: 'Mood tercatat!', id });
});

router.get('/moods', async (req, res) => {
  const userId = (req as any).user.id;
  const { days } = req.query;
  let sql = `SELECT * FROM moods WHERE user_id = ?`;
  const args: any[] = [userId];
  if (days) {
    sql += ` AND created_at >= datetime('now', '-${Number(days)} days')`;
  }
  sql += ` ORDER BY created_at DESC`;
  const result = await db.execute({ sql, args });
  res.json({ moods: result.rows });
});

// ─── IDEAS ──────────────────────────────────────────────
router.get('/ideas', async (req, res) => {
  const userId = (req as any).user.id;
  const result = await db.execute({
    sql: 'SELECT * FROM ideas WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId]
  });
  res.json({ ideas: result.rows.map((i: any) => ({ ...i, tags: JSON.parse(i.tags || '[]') })) });
});

router.post('/ideas', async (req, res) => {
  const userId = (req as any).user.id;
  const { content, tags } = req.body;
  const id = uuidv4();
  await db.execute({
    sql: 'INSERT INTO ideas (id, user_id, content, tags) VALUES (?, ?, ?, ?)',
    args: [id, userId, content, JSON.stringify(tags || [])]
  });
  res.status(201).json({ message: 'Ide tersimpan!', id });
});

router.delete('/ideas/:id', async (req, res) => {
  const userId = (req as any).user.id;
  await db.execute({
    sql: 'DELETE FROM ideas WHERE id = ? AND user_id = ?',
    args: [req.params.id, userId]
  });
  res.json({ message: 'Ide dihapus!' });
});

// ─── DREAMS ─────────────────────────────────────────────
router.get('/dreams', async (req, res) => {
  const userId = (req as any).user.id;
  const result = await db.execute({
    sql: 'SELECT * FROM dreams WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId]
  });
  res.json({ dreams: result.rows });
});

router.post('/dreams', async (req, res) => {
  const userId = (req as any).user.id;
  const { content } = req.body;
  const id = uuidv4();
  await db.execute({
    sql: 'INSERT INTO dreams (id, user_id, content) VALUES (?, ?, ?)',
    args: [id, userId, content]
  });
  res.status(201).json({ message: 'Mimpi tercatat!', id });
});

// ─── HABITS ─────────────────────────────────────────────
router.get('/habits', async (req, res) => {
  const userId = (req as any).user.id;
  const result = await db.execute({
    sql: 'SELECT * FROM habits WHERE user_id = ?',
    args: [userId]
  });
  res.json({ habits: result.rows });
});

router.post('/habits', async (req, res) => {
  const userId = (req as any).user.id;
  const { name, icon } = req.body;
  const id = uuidv4();
  await db.execute({
    sql: 'INSERT INTO habits (id, user_id, name, icon) VALUES (?, ?, ?, ?)',
    args: [id, userId, name, icon || null]
  });
  res.status(201).json({ message: 'Habit dibuat!', id });
});

router.post('/habits/:id/log', async (req, res) => {
  const userId = (req as any).user.id;
  const { date } = req.body;
  const logDate = date || new Date().toISOString().split('T')[0];

  const existing = await db.execute({
    sql: 'SELECT id FROM habit_logs WHERE habit_id = ? AND user_id = ? AND date = ?',
    args: [req.params.id, userId, logDate]
  });

  if (existing.rows.length > 0) {
    await db.execute({
      sql: 'DELETE FROM habit_logs WHERE habit_id = ? AND user_id = ? AND date = ?',
      args: [req.params.id, userId, logDate]
    });
    res.json({ message: 'Habit unlogged!', logged: false });
  } else {
    const id = uuidv4();
    await db.execute({
      sql: 'INSERT INTO habit_logs (id, habit_id, user_id, date) VALUES (?, ?, ?, ?)',
      args: [id, req.params.id, userId, logDate]
    });
    res.json({ message: 'Habit logged!', logged: true });
  }
});

router.get('/habits/:id/logs', async (req, res) => {
  const userId = (req as any).user.id;
  const result = await db.execute({
    sql: 'SELECT * FROM habit_logs WHERE habit_id = ? AND user_id = ? ORDER BY date DESC',
    args: [req.params.id, userId]
  });
  res.json({ logs: result.rows });
});

// ─── MILESTONES ──────────────────────────────────────────
router.get('/milestones', async (req, res) => {
  const userId = (req as any).user.id;
  const result = await db.execute({
    sql: 'SELECT * FROM milestones WHERE user_id = ? ORDER BY achieved_at DESC',
    args: [userId]
  });
  res.json({ milestones: result.rows });
});

router.post('/milestones', async (req, res) => {
  const userId = (req as any).user.id;
  const { title, description, achieved_at } = req.body;
  const id = uuidv4();
  await db.execute({
    sql: 'INSERT INTO milestones (id, user_id, title, description, achieved_at) VALUES (?, ?, ?, ?, ?)',
    args: [id, userId, title, description || null, achieved_at || null]
  });
  res.status(201).json({ message: 'Milestone tersimpan!', id });
});

// ─── CHAPTERS ────────────────────────────────────────────
router.get('/chapters', async (req, res) => {
  const userId = (req as any).user.id;
  const result = await db.execute({
    sql: 'SELECT * FROM chapters WHERE user_id = ? ORDER BY started_at DESC',
    args: [userId]
  });
  res.json({ chapters: result.rows });
});

router.post('/chapters', async (req, res) => {
  const userId = (req as any).user.id;
  const { title, description, color, started_at } = req.body;
  const id = uuidv4();
  await db.execute({
    sql: 'INSERT INTO chapters (id, user_id, title, description, color, started_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, userId, title, description || null, color || null, started_at || null]
  });
  res.status(201).json({ message: 'Chapter dibuat!', id });
});

// ─── ERAS ────────────────────────────────────────────────
router.get('/eras', async (req, res) => {
  const userId = (req as any).user.id;
  const result = await db.execute({
    sql: 'SELECT * FROM eras WHERE user_id = ? ORDER BY started_at DESC',
    args: [userId]
  });
  res.json({ eras: result.rows });
});

router.post('/eras', async (req, res) => {
  const userId = (req as any).user.id;
  const { title, color, started_at } = req.body;
  const id = uuidv4();
  await db.execute({
    sql: 'INSERT INTO eras (id, user_id, title, color, started_at) VALUES (?, ?, ?, ?, ?)',
    args: [id, userId, title, color || null, started_at || null]
  });
  res.status(201).json({ message: 'Era dimulai!', id });
});

// ─── ANALYTICS ───────────────────────────────────────────
router.get('/analytics/summary', async (req, res) => {
  const userId = (req as any).user.id;
  const cacheKey = `analytics:summary:${userId}`;

  const cached = await cacheGet(cacheKey);
  if (cached) {
    res.json({ ...(cached as object), fromCache: true });
    return;
  }

  const [entriesR, moodsR, ideasR, dreamsR, moodAvgR, tagsR, heatmapR, moodGraphR] = await Promise.all([
    db.execute({ sql: 'SELECT COUNT(*) as count FROM entries WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT COUNT(*) as count FROM moods WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT COUNT(*) as count FROM ideas WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT COUNT(*) as count FROM dreams WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT AVG(mood) as avg FROM entries WHERE user_id = ? AND mood IS NOT NULL', args: [userId] }),
    db.execute({ sql: 'SELECT tags FROM entries WHERE user_id = ?', args: [userId] }),
    db.execute({
      sql: `SELECT strftime('%Y-%m-%d', created_at) as date, COUNT(*) as count FROM entries WHERE user_id = ? GROUP BY date ORDER BY date DESC LIMIT 365`,
      args: [userId]
    }),
    db.execute({
      sql: `SELECT strftime('%Y-%m-%d', created_at) as date, AVG(mood) as avg_mood FROM entries WHERE user_id = ? AND mood IS NOT NULL GROUP BY date ORDER BY date DESC LIMIT 30`,
      args: [userId]
    }),
  ]);

  const moodAvg = (moodAvgR.rows[0] as any).avg;
  const tagCount: Record<string, number> = {};
  tagsR.rows.forEach((r: any) => {
    JSON.parse(r.tags || '[]').forEach((t: string) => {
      tagCount[t] = (tagCount[t] || 0) + 1;
    });
  });
  const sortedTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const result = {
    totalEntries: (entriesR.rows[0] as any).count,
    totalMoods: (moodsR.rows[0] as any).count,
    totalIdeas: (ideasR.rows[0] as any).count,
    totalDreams: (dreamsR.rows[0] as any).count,
    moodAverage: moodAvg ? Math.round(moodAvg * 10) / 10 : null,
    topTags: sortedTags,
    heatmap: heatmapR.rows,
    moodGraph: moodGraphR.rows,
  };

  await cacheSet(cacheKey, result, 60 * 30);
  res.json(result);
});

// ─── YEAR IN REVIEW ──────────────────────────────────────
router.get('/analytics/year-review/:year', async (req, res) => {
  const userId = (req as any).user.id;
  const { year } = req.params;

  const result = await db.execute({
    sql: `SELECT * FROM entries WHERE user_id = ? AND strftime('%Y', created_at) = ?`,
    args: [userId, year]
  });

  const entries = result.rows as any[];
  if (entries.length === 0) {
    res.status(404).json({ error: 'Tidak ada entry di tahun ini' });
    return;
  }

  const longest = entries.reduce((a, b) => ((b.content?.length || 0) > (a.content?.length || 0) ? b : a));
  const moodCount: Record<string, number> = {};
  entries.forEach(e => { if (e.mood_label) moodCount[e.mood_label] = (moodCount[e.mood_label] || 0) + 1; });
  const topMood = Object.entries(moodCount).sort((a, b) => b[1] - a[1])[0];

  const words: Record<string, number> = {};
  entries.forEach(e => {
    (e.content || '').toLowerCase().split(/\s+/).forEach((w: string) => {
      if (w.length > 3) words[w] = (words[w] || 0) + 1;
    });
  });
  const topWords = Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 20);

  const tagCount: Record<string, number> = {};
  entries.forEach(e => {
    JSON.parse(e.tags || '[]').forEach((t: string) => { tagCount[t] = (tagCount[t] || 0) + 1; });
  });
  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  res.json({
    year, totalEntries: entries.length,
    longestEntry: { id: longest.id, title: longest.title, length: longest.content?.length },
    topMood: topMood ? { label: topMood[0], count: topMood[1] } : null,
    topWords, topTags,
    firstEntry: entries[entries.length - 1],
    lastEntry: entries[0],
  });
});

// ─── MONTHLY STORY REEL ──────────────────────────────────
router.get('/analytics/monthly-reel/:year/:month', async (req, res) => {
  const userId = (req as any).user.id;
  const { year, month } = req.params;

  const result = await db.execute({
    sql: `SELECT id, title, content, mood, mood_label, tags, media, created_at FROM entries WHERE user_id = ? AND strftime('%Y', created_at) = ? AND strftime('%m', created_at) = ? ORDER BY created_at ASC`,
    args: [userId, year, month.padStart(2, '0')]
  });

  const entries = result.rows as any[];
  if (entries.length === 0) {
    res.status(404).json({ error: 'Tidak ada entry bulan ini' });
    return;
  }

  const slides = entries.map(e => ({
    id: e.id, title: e.title,
    caption: e.content ? e.content.split('.')[0].substring(0, 100) : '',
    mood: e.mood, mood_label: e.mood_label,
    media: JSON.parse(e.media || '[]').slice(0, 1),
    date: e.created_at,
  }));

  const moodEntries = entries.filter(e => e.mood);
  const moodAvg = moodEntries.length > 0
    ? moodEntries.reduce((sum, e) => sum + e.mood, 0) / moodEntries.length
    : null;

  const allTags: Record<string, number> = {};
  entries.forEach(e => JSON.parse(e.tags || '[]').forEach((t: string) => { allTags[t] = (allTags[t] || 0) + 1; }));
  const topTag = Object.entries(allTags).sort((a, b) => b[1] - a[1])[0];

  res.json({
    year, month, totalEntries: entries.length,
    moodAverage: moodAvg ? Math.round(moodAvg * 10) / 10 : null,
    topTag: topTag ? topTag[0] : null,
    slides,
  });
});

// ─── LIFE SATURATION METER ───────────────────────────────
router.get('/analytics/saturation', async (req, res) => {
  const userId = (req as any).user.id;

  const monthsResult = await db.execute({
    sql: `SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as entry_count, AVG(mood) as avg_mood, COUNT(DISTINCT strftime('%d', created_at)) as active_days FROM entries WHERE user_id = ? GROUP BY month ORDER BY month DESC LIMIT 12`,
    args: [userId]
  });

  const saturation = await Promise.all(monthsResult.rows.map(async (m: any) => {
    const [ideasR, habitsR] = await Promise.all([
      db.execute({ sql: `SELECT COUNT(*) as count FROM ideas WHERE user_id = ? AND strftime('%Y-%m', created_at) = ?`, args: [userId, m.month] }),
      db.execute({ sql: `SELECT COUNT(*) as count FROM habit_logs WHERE user_id = ? AND strftime('%Y-%m', date) = ?`, args: [userId, m.month] }),
    ]);

    const ideas = (ideasR.rows[0] as any).count;
    const habits = (habitsR.rows[0] as any).count;
    const score = Math.min(100, Math.round((m.entry_count * 10) + (m.active_days * 3) + (ideas * 5) + (habits * 2)));

    return {
      month: m.month, entryCount: m.entry_count, activeDays: m.active_days,
      avgMood: m.avg_mood ? Math.round(m.avg_mood * 10) / 10 : null,
      ideasCount: ideas, habitsLogged: habits, saturationScore: score,
    };
  }));

  res.json({ saturation });
});

// ─── PAST YOU SAID THIS ──────────────────────────────────
router.get('/analytics/past-quote', async (req, res) => {
  const userId = (req as any).user.id;

  const result = await db.execute({
    sql: `SELECT id, title, content, mood_label, created_at FROM entries WHERE user_id = ? AND content IS NOT NULL AND length(content) > 20 AND created_at <= datetime('now', '-6 months') ORDER BY RANDOM() LIMIT 1`,
    args: [userId]
  });

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Belum ada memory lama yang cukup' });
    return;
  }

  const entry = result.rows[0] as any;
  const sentences = (entry.content as string).split(/[.!?]+/).filter((s: string) => s.trim().length > 20);
  const quote = sentences.sort((a: string, b: string) => b.length - a.length)[0]?.trim() || (entry.content as string).substring(0, 150);

  res.json({
    entryId: entry.id, quote, moodLabel: entry.mood_label, createdAt: entry.created_at,
    yearsAgo: new Date().getFullYear() - new Date(entry.created_at as string).getFullYear(),
    monthsAgo: Math.floor((Date.now() - new Date(entry.created_at as string).getTime()) / (1000 * 60 * 60 * 24 * 30)),
  });
});

// ─── PDF EXPORT ──────────────────────────────────────────
router.get('/export/pdf', async (req, res) => {
  const userId = (req as any).user.id;
  const { year, month } = req.query;

  let sql = `SELECT * FROM entries WHERE user_id = ?`;
  const args: any[] = [userId];
  let period = 'All Time';

  if (year && month) {
    sql += ` AND strftime('%Y', created_at) = ? AND strftime('%m', created_at) = ?`;
    args.push(year, String(month).padStart(2, '0'));
    period = `${year} - Bulan ${month}`;
  } else if (year) {
    sql += ` AND strftime('%Y', created_at) = ?`;
    args.push(year);
    period = `Tahun ${year}`;
  }

  sql += ` ORDER BY created_at ASC`;

  const result = await db.execute({ sql, args });
  const entries = result.rows.map((e: any) => ({
    ...e,
    tags: JSON.parse(e.tags || '[]'),
    media: JSON.parse(e.media || '[]'),
  }));

  if (entries.length === 0) {
    res.status(404).json({ error: 'Tidak ada entry untuk periode ini' });
    return;
  }

  const userResult = await db.execute({ sql: 'SELECT name FROM users WHERE id = ?', args: [userId] });
  const user = userResult.rows[0] as any;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="life-album-${period.replace(/\s/g, '-')}.pdf"`);

  const pdfStream = generateLifeAlbumPDF(entries, { name: user.name, period });
  pdfStream.pipe(res);
});

// ─── ACTIVITY LOGS ───────────────────────────────────────
router.get('/activity-logs', async (req, res) => {
  const userId = (req as any).user.id;
  const result = await db.execute({
    sql: 'SELECT * FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    args: [userId]
  });
  res.json({ logs: result.rows });
});

export default router;