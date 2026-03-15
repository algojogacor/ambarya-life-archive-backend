import { cacheGet, cacheSet, cacheDel } from '../services/cache.service';
import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import db from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import { generateLifeAlbumPDF } from '../services/pdf.service';

const router = Router();
router.use(authenticate);

// ─── MOOD LOG ───────────────────────────────────────────
router.post('/moods', (req, res) => {
  const userId = (req as any).user.id;
  const { mood, mood_label, note } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO moods (id, user_id, mood, mood_label, note) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, mood, mood_label, note || null);
  res.status(201).json({ message: 'Mood tercatat!', id });
});

router.get('/moods', (req, res) => {
  const userId = (req as any).user.id;
  const { days } = req.query;
  const limit = days ? `AND created_at >= datetime('now', '-${Number(days)} days')` : '';
  const moods = db.prepare(`SELECT * FROM moods WHERE user_id = ? ${limit} ORDER BY created_at DESC`).all(userId);
  res.json({ moods });
});

// ─── IDEAS ──────────────────────────────────────────────
router.get('/ideas', (req, res) => {
  const userId = (req as any).user.id;
  const ideas = db.prepare('SELECT * FROM ideas WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  res.json({ ideas: ideas.map((i: any) => ({ ...i, tags: JSON.parse(i.tags || '[]') })) });
});

router.post('/ideas', (req, res) => {
  const userId = (req as any).user.id;
  const { content, tags } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO ideas (id, user_id, content, tags) VALUES (?, ?, ?, ?)')
    .run(id, userId, content, JSON.stringify(tags || []));
  res.status(201).json({ message: 'Ide tersimpan!', id });
});

router.delete('/ideas/:id', (req, res) => {
  const userId = (req as any).user.id;
  db.prepare('DELETE FROM ideas WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  res.json({ message: 'Ide dihapus!' });
});

// ─── DREAMS ─────────────────────────────────────────────
router.get('/dreams', (req, res) => {
  const userId = (req as any).user.id;
  const dreams = db.prepare('SELECT * FROM dreams WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  res.json({ dreams });
});

router.post('/dreams', (req, res) => {
  const userId = (req as any).user.id;
  const { content } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO dreams (id, user_id, content) VALUES (?, ?, ?)').run(id, userId, content);
  res.status(201).json({ message: 'Mimpi tercatat!', id });
});

// ─── HABITS ─────────────────────────────────────────────
router.get('/habits', (req, res) => {
  const userId = (req as any).user.id;
  const habits = db.prepare('SELECT * FROM habits WHERE user_id = ?').all(userId);
  res.json({ habits });
});

router.post('/habits', (req, res) => {
  const userId = (req as any).user.id;
  const { name, icon } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO habits (id, user_id, name, icon) VALUES (?, ?, ?, ?)').run(id, userId, name, icon || null);
  res.status(201).json({ message: 'Habit dibuat!', id });
});

router.post('/habits/:id/log', (req, res) => {
  const userId = (req as any).user.id;
  const { date } = req.body;
  const logDate = date || new Date().toISOString().split('T')[0];
  const existing = db.prepare('SELECT id FROM habit_logs WHERE habit_id = ? AND user_id = ? AND date = ?')
    .get(req.params.id, userId, logDate);
  if (existing) {
    db.prepare('DELETE FROM habit_logs WHERE habit_id = ? AND user_id = ? AND date = ?')
      .run(req.params.id, userId, logDate);
    res.json({ message: 'Habit unlogged!', logged: false });
  } else {
    const id = uuidv4();
    db.prepare('INSERT INTO habit_logs (id, habit_id, user_id, date) VALUES (?, ?, ?, ?)').run(id, req.params.id, userId, logDate);
    res.json({ message: 'Habit logged!', logged: true });
  }
});

router.get('/habits/:id/logs', (req, res) => {
  const userId = (req as any).user.id;
  const logs = db.prepare('SELECT * FROM habit_logs WHERE habit_id = ? AND user_id = ? ORDER BY date DESC').all(req.params.id, userId);
  res.json({ logs });
});

// ─── MILESTONES ──────────────────────────────────────────
router.get('/milestones', (req, res) => {
  const userId = (req as any).user.id;
  const milestones = db.prepare('SELECT * FROM milestones WHERE user_id = ? ORDER BY achieved_at DESC').all(userId);
  res.json({ milestones });
});

router.post('/milestones', (req, res) => {
  const userId = (req as any).user.id;
  const { title, description, achieved_at } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO milestones (id, user_id, title, description, achieved_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, title, description || null, achieved_at || null);
  res.status(201).json({ message: 'Milestone tersimpan!', id });
});

// ─── CHAPTERS ────────────────────────────────────────────
router.get('/chapters', (req, res) => {
  const userId = (req as any).user.id;
  const chapters = db.prepare('SELECT * FROM chapters WHERE user_id = ? ORDER BY started_at DESC').all(userId);
  res.json({ chapters });
});

router.post('/chapters', (req, res) => {
  const userId = (req as any).user.id;
  const { title, description, color, started_at } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO chapters (id, user_id, title, description, color, started_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, title, description || null, color || null, started_at || null);
  res.status(201).json({ message: 'Chapter dibuat!', id });
});

// ─── ERAS ────────────────────────────────────────────────
router.get('/eras', (req, res) => {
  const userId = (req as any).user.id;
  const eras = db.prepare('SELECT * FROM eras WHERE user_id = ? ORDER BY started_at DESC').all(userId);
  res.json({ eras });
});

router.post('/eras', (req, res) => {
  const userId = (req as any).user.id;
  const { title, color, started_at } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO eras (id, user_id, title, color, started_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, title, color || null, started_at || null);
  res.status(201).json({ message: 'Era dimulai!', id });
});

// ─── ANALYTICS ───────────────────────────────────────────
router.get('/analytics/summary', async (req, res) => {
  const userId = (req as any).user.id;
  const cacheKey = `analytics:summary:${userId}`;

  // Cek cache dulu
  const cached = await cacheGet(cacheKey);
  if (cached) {
    res.json({ ...cached as object, fromCache: true });
    return;
  }

  const totalEntries = (db.prepare('SELECT COUNT(*) as count FROM entries WHERE user_id = ?').get(userId) as any).count;
  const totalMoods = (db.prepare('SELECT COUNT(*) as count FROM moods WHERE user_id = ?').get(userId) as any).count;
  const totalIdeas = (db.prepare('SELECT COUNT(*) as count FROM ideas WHERE user_id = ?').get(userId) as any).count;
  const totalDreams = (db.prepare('SELECT COUNT(*) as count FROM dreams WHERE user_id = ?').get(userId) as any).count;

  const moodAvg = (db.prepare('SELECT AVG(mood) as avg FROM entries WHERE user_id = ? AND mood IS NOT NULL').get(userId) as any).avg;

  const topTags: any[] = db.prepare('SELECT tags FROM entries WHERE user_id = ?').all(userId);
  const tagCount: Record<string, number> = {};
  topTags.forEach((e: any) => {
    JSON.parse(e.tags || '[]').forEach((t: string) => {
      tagCount[t] = (tagCount[t] || 0) + 1;
    });
  });
  const sortedTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const heatmap = db.prepare(`
    SELECT strftime('%Y-%m-%d', created_at) as date, COUNT(*) as count 
    FROM entries WHERE user_id = ? 
    GROUP BY date ORDER BY date DESC LIMIT 365
  `).all(userId);

  const moodGraph = db.prepare(`
    SELECT strftime('%Y-%m-%d', created_at) as date, AVG(mood) as avg_mood
    FROM entries WHERE user_id = ? AND mood IS NOT NULL
    GROUP BY date ORDER BY date DESC LIMIT 30
  `).all(userId);

  const result = {
    totalEntries, totalMoods, totalIdeas, totalDreams,
    moodAverage: moodAvg ? Math.round(moodAvg * 10) / 10 : null,
    topTags: sortedTags,
    heatmap,
    moodGraph,
  };

  await cacheSet(cacheKey, result, 60 * 30); // cache 30 menit
  res.json(result);
});

// ─── YEAR IN REVIEW ──────────────────────────────────────
router.get('/analytics/year-review/:year', (req, res) => {
  const userId = (req as any).user.id;
  const { year } = req.params;

  const entries = db.prepare(`
    SELECT * FROM entries WHERE user_id = ? AND strftime('%Y', created_at) = ?
  `).all(userId, year) as any[];

  if (entries.length === 0) {
    res.status(404).json({ error: 'Tidak ada entry di tahun ini' });
    return;
  }

  // Entry terpanjang
  const longest = entries.reduce((a, b) => (b.content?.length > a.content?.length ? b : a));

  // Mood terbanyak
  const moodCount: Record<string, number> = {};
  entries.forEach(e => { if (e.mood_label) moodCount[e.mood_label] = (moodCount[e.mood_label] || 0) + 1; });
  const topMood = Object.entries(moodCount).sort((a, b) => b[1] - a[1])[0];

  // Most used words
  const words: Record<string, number> = {};
  entries.forEach(e => {
    (e.content || '').toLowerCase().split(/\s+/).forEach((w: string) => {
      if (w.length > 3) words[w] = (words[w] || 0) + 1;
    });
  });
  const topWords = Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 20);

  // Top tags
  const tagCount: Record<string, number> = {};
  entries.forEach(e => {
    JSON.parse(e.tags || '[]').forEach((t: string) => { tagCount[t] = (tagCount[t] || 0) + 1; });
  });
  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  res.json({
    year,
    totalEntries: entries.length,
    longestEntry: { id: longest.id, title: longest.title, length: longest.content?.length },
    topMood: topMood ? { label: topMood[0], count: topMood[1] } : null,
    topWords,
    topTags,
    firstEntry: entries[entries.length - 1],
    lastEntry: entries[0],
  });
});

// ─── MONTHLY STORY REEL ──────────────────────────────────
router.get('/analytics/monthly-reel/:year/:month', (req, res) => {
  const userId = (req as any).user.id;
  const { year, month } = req.params;

  const entries = db.prepare(`
    SELECT id, title, content, mood, mood_label, tags, media, created_at
    FROM entries 
    WHERE user_id = ? 
    AND strftime('%Y', created_at) = ?
    AND strftime('%m', created_at) = ?
    ORDER BY created_at ASC
  `).all(userId, year, month.padStart(2, '0')) as any[];

  if (entries.length === 0) {
    res.status(404).json({ error: 'Tidak ada entry bulan ini' });
    return;
  }

  // Ambil highlight: 1 kalimat pertama tiap entry sebagai slide caption
  const slides = entries.map(e => ({
    id: e.id,
    title: e.title,
    caption: e.content ? e.content.split('.')[0].substring(0, 100) : '',
    mood: e.mood,
    mood_label: e.mood_label,
    media: JSON.parse(e.media || '[]').slice(0, 1), // foto pertama aja
    date: e.created_at,
  }));

  // Stats bulan ini
  const moodAvg = entries.filter(e => e.mood).reduce((sum, e) => sum + e.mood, 0) / entries.filter(e => e.mood).length;
  const allTags: Record<string, number> = {};
  entries.forEach(e => JSON.parse(e.tags || '[]').forEach((t: string) => { allTags[t] = (allTags[t] || 0) + 1; }));
  const topTag = Object.entries(allTags).sort((a, b) => b[1] - a[1])[0];

  res.json({
    year, month,
    totalEntries: entries.length,
    moodAverage: moodAvg ? Math.round(moodAvg * 10) / 10 : null,
    topTag: topTag ? topTag[0] : null,
    slides,
  });
});

// ─── LIFE SATURATION METER ───────────────────────────────
router.get('/analytics/saturation', (req, res) => {
  const userId = (req as any).user.id;

  const months = db.prepare(`
    SELECT 
      strftime('%Y-%m', created_at) as month,
      COUNT(*) as entry_count,
      AVG(mood) as avg_mood,
      COUNT(DISTINCT strftime('%d', created_at)) as active_days
    FROM entries 
    WHERE user_id = ?
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `).all(userId) as any[];

  const saturation = months.map(m => {
    const ideas = (db.prepare(`
      SELECT COUNT(*) as count FROM ideas 
      WHERE user_id = ? AND strftime('%Y-%m', created_at) = ?
    `).get(userId, m.month) as any).count;

    const habits = (db.prepare(`
      SELECT COUNT(*) as count FROM habit_logs 
      WHERE user_id = ? AND strftime('%Y-%m', date) = ?
    `).get(userId, m.month) as any).count;

    // Saturation score: kombinasi aktifitas
    const score = Math.min(100, Math.round(
      (m.entry_count * 10) +
      (m.active_days * 3) +
      (ideas * 5) +
      (habits * 2)
    ));

    return {
      month: m.month,
      entryCount: m.entry_count,
      activeDays: m.active_days,
      avgMood: m.avg_mood ? Math.round(m.avg_mood * 10) / 10 : null,
      ideasCount: ideas,
      habitsLogged: habits,
      saturationScore: score,
    };
  });

  res.json({ saturation });
});

// ─── PAST YOU SAID THIS ──────────────────────────────────
router.get('/analytics/past-quote', (req, res) => {
  const userId = (req as any).user.id;

  // Ambil entry dari minimal 1 tahun lalu, random, yang punya konten
  const entry = db.prepare(`
    SELECT id, title, content, mood_label, created_at 
    FROM entries 
    WHERE user_id = ? 
    AND content IS NOT NULL 
    AND length(content) > 20
    AND created_at <= datetime('now', '-6 months')
    ORDER BY RANDOM() 
    LIMIT 1
  `).get(userId) as any;

  if (!entry) {
    res.status(404).json({ error: 'Belum ada memory lama yang cukup' });
    return;
  }

  // Ambil 1 kalimat paling menarik (terpanjang)
  const sentences = entry.content.split(/[.!?]+/).filter((s: string) => s.trim().length > 20);
  const quote = sentences.sort((a: string, b: string) => b.length - a.length)[0]?.trim() || entry.content.substring(0, 150);

  res.json({
    entryId: entry.id,
    quote,
    moodLabel: entry.mood_label,
    createdAt: entry.created_at,
    yearsAgo: new Date().getFullYear() - new Date(entry.created_at).getFullYear(),
    monthsAgo: Math.floor((Date.now() - new Date(entry.created_at).getTime()) / (1000 * 60 * 60 * 24 * 30)),
  });
});

// ─── PDF EXPORT ──────────────────────────────────────────
router.get('/export/pdf', (req, res) => {
  const userId = (req as any).user.id;
  const { year, month } = req.query;

  let query = `SELECT * FROM entries WHERE user_id = ?`;
  const params: any[] = [userId];
  let period = 'All Time';

  if (year && month) {
    query += ` AND strftime('%Y', created_at) = ? AND strftime('%m', created_at) = ?`;
    params.push(year, String(month).padStart(2, '0'));
    period = `${year} - Bulan ${month}`;
  } else if (year) {
    query += ` AND strftime('%Y', created_at) = ?`;
    params.push(year);
    period = `Tahun ${year}`;
  }

  query += ` ORDER BY created_at ASC`;

  const entries = (db.prepare(query).all(...params) as any[]).map(e => ({
    ...e,
    tags: JSON.parse(e.tags || '[]'),
    media: JSON.parse(e.media || '[]'),
  }));

  if (entries.length === 0) {
    res.status(404).json({ error: 'Tidak ada entry untuk periode ini' });
    return;
  }

  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as any;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="life-album-${period.replace(/\s/g, '-')}.pdf"`);

  const pdfStream = generateLifeAlbumPDF(entries, { name: user.name, period });
  pdfStream.pipe(res);
});

export default router;