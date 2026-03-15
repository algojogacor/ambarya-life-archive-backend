import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { uploadFile, deleteFile } from '../services/gdrive.service';
import bcrypt from 'bcryptjs';
import { compressImage } from '../services/compress.service';
import { logActivity } from '../services/activity.service';
import logger from '../services/logger.service';

// GET semua entries milik user
export const getEntries = (req: Request, res: Response): void => {
  const userId = (req as any).user.id;
  const { tag, mood, year, month, search } = req.query;

  let query = `SELECT * FROM entries WHERE user_id = ?`;
  const params: any[] = [userId];

  if (mood) { query += ` AND mood = ?`; params.push(mood); }
  if (year) { query += ` AND strftime('%Y', created_at) = ?`; params.push(year); }
  if (month) { query += ` AND strftime('%m', created_at) = ?`; params.push(month); }
  if (search) { query += ` AND (content LIKE ? OR title LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }

  query += ` ORDER BY created_at DESC`;

  let entries = db.prepare(query).all(...params) as any[];

  if (tag) {
    entries = entries.filter(e => {
      const tags = JSON.parse(e.tags || '[]');
      return tags.includes(tag);
    });
  }

  entries = entries.map(e => ({
    ...e,
    tags: JSON.parse(e.tags || '[]'),
    media: JSON.parse(e.media || '[]'),
  }));

  res.json({ entries });
};

// GET single entry
export const getEntry = (req: Request, res: Response): void => {
  const userId = (req as any).user.id;
  const { id } = req.params;

  const entry = db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?').get(id, userId) as any;

  if (!entry) {
    res.status(404).json({ error: 'Entry tidak ditemukan' });
    return;
  }

  res.json({
    entry: {
      ...entry,
      tags: JSON.parse(entry.tags || '[]'),
      media: JSON.parse(entry.media || '[]'),
    }
  });
};

// POST buat entry baru
export const createEntry = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const {
    title, content, mood, mood_label,
    weather, location_text, location_lat, location_lng,
    tags, is_private, is_time_capsule, unlock_at,
    chapter_id, era_id
  } = req.body;

  const id = uuidv4();
  const tagsJson = JSON.stringify(tags || []);
  const mediaJson = JSON.stringify([]);

  db.prepare(`
    INSERT INTO entries (
      id, user_id, title, content, mood, mood_label,
      weather, location_text, location_lat, location_lng,
      tags, media, is_private, is_time_capsule, unlock_at,
      chapter_id, era_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, userId, title || null, content || null,
    mood || null, mood_label || null,
    weather || null, location_text || null,
    location_lat || null, location_lng || null,
    tagsJson, mediaJson,
    is_private ? 1 : 0,
    is_time_capsule ? 1 : 0,
    unlock_at || null,
    chapter_id || null,
    era_id || null
  );

  logActivity(userId, 'entry.create', 'entry', id, { title, mood_label });
  logger.info('Entry created', { userId, entryId: id });

  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as any;

  res.status(201).json({
    message: 'Entry berhasil dibuat!',
    entry: {
      ...entry,
      tags: JSON.parse(entry.tags || '[]'),
      media: JSON.parse(entry.media || '[]'),
    }
  });
};

// POST upload media ke entry
export const uploadMedia = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const { id } = req.params;

  const entry = db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!entry) {
    res.status(404).json({ error: 'Entry tidak ditemukan' });
    return;
  }

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'Tidak ada file yang diupload' });
    return;
  }

  const uploaded: any[] = [];

  for (const file of files) {
    const subfolder = file.mimetype.startsWith('image/') ? 'photos'
      : file.mimetype.startsWith('video/') ? 'videos'
      : file.mimetype.startsWith('audio/') ? 'voices'
      : 'others';

    try {
      const { buffer, mimeType } = await compressImage(file.buffer, file.mimetype);

      const ext = mimeType === 'image/webp' ? 'webp' : file.originalname.split('.').pop();
      const filename = `${uuidv4()}_${file.originalname.replace(/\.[^.]+$/, '')}.${ext}`;

      const { fileId, webViewLink } = await uploadFile(buffer, filename, mimeType, subfolder);

      uploaded.push({
        fileId,
        url: webViewLink,
        type: subfolder,
        name: file.originalname,
        originalSize: file.size,
        size: buffer.length,
        compressed: buffer.length < file.size,
      });
    } catch (err) {
      logActivity(userId, 'media.upload_failed', 'entry', String(id), { filename: file.originalname });
      logger.error('Media upload failed', { userId, entryId: id, filename: file.originalname, err });
      throw err;
    }
  }

  const existingMedia = JSON.parse(entry.media || '[]');
  const newMedia = [...existingMedia, ...uploaded];

  db.prepare('UPDATE entries SET media = ?, updated_at = datetime("now") WHERE id = ?')
    .run(JSON.stringify(newMedia), id);

  logActivity(userId, 'media.upload', 'entry', String(id), { count: uploaded.length });

  res.json({ message: 'Media berhasil diupload!', media: newMedia });
};

// PUT update entry
export const updateEntry = (req: Request, res: Response): void => {
  const userId = (req as any).user.id;
  const { id } = req.params;

  const oldEntry = db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!oldEntry) {
    res.status(404).json({ error: 'Entry tidak ditemukan' });
    return;
  }

  // Simpan versi sebelumnya
  const currentVersion = db.prepare(
    'SELECT COUNT(*) as count FROM entry_versions WHERE entry_id = ?'
  ).get(id) as any;

  db.prepare(`
    INSERT INTO entry_versions (id, entry_id, user_id, title, content, mood, mood_label, tags, version_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(), id, userId,
    oldEntry.title, oldEntry.content,
    oldEntry.mood, oldEntry.mood_label,
    oldEntry.tags,
    currentVersion.count + 1
  );

  const {
    title, content, mood, mood_label,
    weather, location_text, tags, chapter_id, era_id
  } = req.body;

  db.prepare(`
    UPDATE entries SET
      title = COALESCE(?, title),
      content = COALESCE(?, content),
      mood = COALESCE(?, mood),
      mood_label = COALESCE(?, mood_label),
      weather = COALESCE(?, weather),
      location_text = COALESCE(?, location_text),
      tags = COALESCE(?, tags),
      chapter_id = COALESCE(?, chapter_id),
      era_id = COALESCE(?, era_id),
      updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(
    title, content, mood, mood_label,
    weather, location_text,
    tags ? JSON.stringify(tags) : null,
    chapter_id, era_id, id, userId
  );

  logActivity(userId, 'entry.update', 'entry', String(id));

  const updated = db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as any;
  res.json({
    message: 'Entry berhasil diupdate!',
    entry: {
      ...updated,
      tags: JSON.parse(updated.tags || '[]'),
      media: JSON.parse(updated.media || '[]'),
    }
  });
};

// DELETE entry
export const deleteEntry = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const { id } = req.params;

  const entry = db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!entry) {
    res.status(404).json({ error: 'Entry tidak ditemukan' });
    return;
  }

  const media = JSON.parse(entry.media || '[]');
  for (const m of media) {
    try { await deleteFile(m.fileId); } catch {}
  }

  db.prepare('DELETE FROM entry_versions WHERE entry_id = ?').run(id);
  db.prepare('DELETE FROM entries WHERE id = ?').run(id);

  logActivity(userId, 'entry.delete', 'entry', String(id), { title: entry.title });
  logger.info('Entry deleted', { userId, entryId: id });

  res.json({ message: 'Entry berhasil dihapus!' });
};

// GET On This Day
export const getOnThisDay = (req: Request, res: Response): void => {
  const userId = (req as any).user.id;
  const today = new Date();
  const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const entries = db.prepare(`
    SELECT * FROM entries 
    WHERE user_id = ? 
    AND strftime('%m-%d', created_at) = ?
    AND strftime('%Y', created_at) != strftime('%Y', 'now')
    ORDER BY created_at DESC
  `).all(userId, mmdd) as any[];

  res.json({
    entries: entries.map(e => ({
      ...e,
      tags: JSON.parse(e.tags || '[]'),
      media: JSON.parse(e.media || '[]'),
    }))
  });
};

// GET Random Memory
export const getRandomMemory = (req: Request, res: Response): void => {
  const userId = (req as any).user.id;

  const entry = db.prepare(`
    SELECT * FROM entries 
    WHERE user_id = ? 
    AND (is_time_capsule = 0 OR (is_time_capsule = 1 AND unlock_at <= datetime('now')))
    ORDER BY RANDOM() LIMIT 1
  `).get(userId) as any;

  if (!entry) {
    res.status(404).json({ error: 'Belum ada memory' });
    return;
  }

  res.json({
    entry: {
      ...entry,
      tags: JSON.parse(entry.tags || '[]'),
      media: JSON.parse(entry.media || '[]'),
    }
  });
};

// POST set PIN untuk hidden memory
export const setPin = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  const { pin } = req.body;

  const entry = db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?').get(id, userId);
  if (!entry) { res.status(404).json({ error: 'Entry tidak ditemukan' }); return; }

  const pinHash = bcrypt.hashSync(pin, 10);
  db.prepare('UPDATE entries SET is_private = 1, pin_hash = ? WHERE id = ?').run(pinHash, id);
  res.json({ message: 'PIN berhasil dipasang!' });
};

// POST verify PIN hidden memory
export const verifyPin = (req: Request, res: Response): void => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  const { pin } = req.body;

  const entry = db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!entry) { res.status(404).json({ error: 'Entry tidak ditemukan' }); return; }
  if (!entry.pin_hash) { res.status(400).json({ error: 'Entry ini tidak memiliki PIN' }); return; }

  const valid = bcrypt.compareSync(pin, entry.pin_hash);
  if (!valid) { res.status(401).json({ error: 'PIN salah' }); return; }

  res.json({
    message: 'PIN benar!',
    entry: {
      ...entry,
      tags: JSON.parse(entry.tags || '[]'),
      media: JSON.parse(entry.media || '[]'),
      pin_hash: undefined,
    }
  });
};

// GET entry versions
export const getVersions = (req: Request, res: Response): void => {
  const userId = (req as any).user.id;
  const { id } = req.params;

  const versions = db.prepare(`
    SELECT * FROM entry_versions 
    WHERE entry_id = ? AND user_id = ?
    ORDER BY version_number DESC
  `).all(id, userId);

  res.json({ versions });
};

// POST rollback ke versi sebelumnya
export const rollbackVersion = (req: Request, res: Response): void => {
  const userId = (req as any).user.id;
  const { id, versionId } = req.params;

  const version = db.prepare(`
    SELECT * FROM entry_versions WHERE id = ? AND entry_id = ? AND user_id = ?
  `).get(versionId, id, userId) as any;

  if (!version) {
    res.status(404).json({ error: 'Versi tidak ditemukan' });
    return;
  }

  db.prepare(`
    UPDATE entries SET
      title = ?, content = ?, mood = ?, mood_label = ?, tags = ?,
      updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(version.title, version.content, version.mood, version.mood_label, version.tags, id, userId);

  logActivity(userId, 'entry.update', 'entry', String(id), { rollback_to_version: version.version_number });
  logger.info('Entry rolled back', { userId, entryId: id, version: version.version_number });

  res.json({ message: `Berhasil rollback ke versi ${version.version_number}!` });
};