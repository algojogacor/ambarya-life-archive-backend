import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { uploadFile, deleteFile } from '../services/gdrive.service';
import bcrypt from 'bcryptjs';
import { compressImage } from '../services/compress.service';
import { logActivity } from '../services/activity.service';
import logger from '../services/logger.service';

const parseEntry = (row: any) => ({
  ...row,
  tags: JSON.parse((row.tags as string) || '[]'),
  media: JSON.parse((row.media as string) || '[]'),
});

export const getEntries = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const { tag, mood, year, month, search } = req.query;

  let sql = `SELECT * FROM entries WHERE user_id = ?`;
  const args: any[] = [userId];

  if (mood) { sql += ` AND mood = ?`; args.push(mood); }
  if (year) { sql += ` AND strftime('%Y', created_at) = ?`; args.push(year); }
  if (month) { sql += ` AND strftime('%m', created_at) = ?`; args.push(month); }
  if (search) { sql += ` AND (content LIKE ? OR title LIKE ?)`; args.push(`%${search}%`, `%${search}%`); }
  sql += ` ORDER BY created_at DESC`;

  const result = await db.execute({ sql, args });
  let entries = result.rows.map(parseEntry);

  if (tag) {
    entries = entries.filter((e: any) => e.tags.includes(tag));
  }

  res.json({ entries });
};

export const getEntry = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const id = String(req.params.id);

  const result = await db.execute({
    sql: 'SELECT * FROM entries WHERE id = ? AND user_id = ?',
    args: [id, userId]
  });

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Entry tidak ditemukan' });
    return;
  }

  res.json({ entry: parseEntry(result.rows[0]) });
};

export const createEntry = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const {
    title, content, mood, mood_label,
    weather, location_text, location_lat, location_lng,
    tags, is_private, is_time_capsule, unlock_at,
    chapter_id, era_id,
    music_title, music_artist, music_album_art, music_preview_url, music_itunes_url,
    step_count, energy_level, sleep_hours,
  } = req.body;

  const id = uuidv4();

  await db.execute({
    sql: `INSERT INTO entries (
      id, user_id, title, content, mood, mood_label,
      weather, location_text, location_lat, location_lng,
      tags, media, is_private, is_time_capsule, unlock_at,
      chapter_id, era_id,
      music_title, music_artist, music_album_art, music_preview_url, music_itunes_url,
      step_count, energy_level, sleep_hours
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, userId, title || null, content || null,
      mood || null, mood_label || null,
      weather || null, location_text || null,
      location_lat || null, location_lng || null,
      JSON.stringify(tags || []), JSON.stringify([]),
      is_private ? 1 : 0,
      is_time_capsule ? 1 : 0,
      unlock_at || null,
      chapter_id || null,
      era_id || null,
      music_title || null,
      music_artist || null,
      music_album_art || null,
      music_preview_url || null,
      music_itunes_url || null,
      step_count || null,
      energy_level || null,
      sleep_hours || null,
    ]
  });

  await logActivity(userId, 'entry.create', 'entry', id, { title, mood_label });
  logger.info('Entry created', { userId, entryId: id });

  const entryResult = await db.execute({ sql: 'SELECT * FROM entries WHERE id = ?', args: [id] });
  res.status(201).json({ message: 'Entry berhasil dibuat!', entry: parseEntry(entryResult.rows[0]) });
};

export const uploadMedia = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const id = String(req.params.id);

  const entryResult = await db.execute({
    sql: 'SELECT * FROM entries WHERE id = ? AND user_id = ?',
    args: [id, userId]
  });

  if (entryResult.rows.length === 0) {
    res.status(404).json({ error: 'Entry tidak ditemukan' });
    return;
  }

  const entry = entryResult.rows[0] as any;
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
        fileId, url: webViewLink, type: subfolder,
        name: file.originalname, originalSize: file.size,
        size: buffer.length, compressed: buffer.length < file.size,
      });
    } catch (err) {
      await logActivity(userId, 'media.upload_failed', 'entry', id, { filename: file.originalname });
      logger.error('Media upload failed', { userId, entryId: id, filename: file.originalname, err });
      throw err;
    }
  }

  const existingMedia = JSON.parse((entry.media as string) || '[]');
  const newMedia = [...existingMedia, ...uploaded];

  await db.execute({
    sql: 'UPDATE entries SET media = ?, updated_at = datetime("now") WHERE id = ?',
    args: [JSON.stringify(newMedia), id]
  });

  await logActivity(userId, 'media.upload', 'entry', id, { count: uploaded.length });
  res.json({ message: 'Media berhasil diupload!', media: newMedia });
};

export const updateEntry = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const id = String(req.params.id);

  const oldResult = await db.execute({
    sql: 'SELECT * FROM entries WHERE id = ? AND user_id = ?',
    args: [id, userId]
  });

  if (oldResult.rows.length === 0) {
    res.status(404).json({ error: 'Entry tidak ditemukan' });
    return;
  }

  const oldEntry = oldResult.rows[0] as any;

  const versionResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM entry_versions WHERE entry_id = ?',
    args: [id]
  });
  const versionCount = (versionResult.rows[0] as any).count;

  await db.execute({
    sql: `INSERT INTO entry_versions (id, entry_id, user_id, title, content, mood, mood_label, tags, version_number)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      uuidv4(), id, userId,
      oldEntry.title, oldEntry.content,
      oldEntry.mood, oldEntry.mood_label,
      oldEntry.tags,
      Number(versionCount) + 1
    ]
  });

  const {
    title, content, mood, mood_label, weather, location_text, tags, chapter_id, era_id,
    music_title, music_artist, music_album_art, music_preview_url, music_itunes_url,
    step_count, energy_level, sleep_hours,
  } = req.body;

  await db.execute({
    sql: `UPDATE entries SET
      title = COALESCE(?, title),
      content = COALESCE(?, content),
      mood = COALESCE(?, mood),
      mood_label = COALESCE(?, mood_label),
      weather = COALESCE(?, weather),
      location_text = COALESCE(?, location_text),
      tags = COALESCE(?, tags),
      chapter_id = COALESCE(?, chapter_id),
      era_id = COALESCE(?, era_id),
      music_title = COALESCE(?, music_title),
      music_artist = COALESCE(?, music_artist),
      music_album_art = COALESCE(?, music_album_art),
      music_preview_url = COALESCE(?, music_preview_url),
      music_itunes_url = COALESCE(?, music_itunes_url),
      step_count = COALESCE(?, step_count),
      energy_level = COALESCE(?, energy_level),
      sleep_hours = COALESCE(?, sleep_hours),
      updated_at = datetime('now')
    WHERE id = ? AND user_id = ?`,
    args: [
      title || null, content || null, mood || null, mood_label || null,
      weather || null, location_text || null,
      tags ? JSON.stringify(tags) : null,
      chapter_id || null, era_id || null,
      music_title || null, music_artist || null,
      music_album_art || null, music_preview_url || null, music_itunes_url || null,
      step_count || null, energy_level || null, sleep_hours || null,
      id, userId
    ]
  });

  await logActivity(userId, 'entry.update', 'entry', id);

  const updated = await db.execute({ sql: 'SELECT * FROM entries WHERE id = ?', args: [id] });
  res.json({ message: 'Entry berhasil diupdate!', entry: parseEntry(updated.rows[0]) });
};

export const deleteEntry = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const id = String(req.params.id);

  const result = await db.execute({
    sql: 'SELECT * FROM entries WHERE id = ? AND user_id = ?',
    args: [id, userId]
  });

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Entry tidak ditemukan' });
    return;
  }

  const entry = result.rows[0] as any;
  const media = JSON.parse((entry.media as string) || '[]');

  for (const m of media) {
    try { await deleteFile(m.fileId); } catch {}
  }

  await db.execute({ sql: 'DELETE FROM entry_versions WHERE entry_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM entries WHERE id = ?', args: [id] });

  await logActivity(userId, 'entry.delete', 'entry', id, { title: entry.title });
  logger.info('Entry deleted', { userId, entryId: id });
  res.json({ message: 'Entry berhasil dihapus!' });
};

export const getOnThisDay = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const today = new Date();
  const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const result = await db.execute({
    sql: `SELECT * FROM entries 
          WHERE user_id = ? 
          AND strftime('%m-%d', created_at) = ?
          AND strftime('%Y', created_at) != strftime('%Y', 'now')
          ORDER BY created_at DESC`,
    args: [userId, mmdd]
  });

  res.json({ entries: result.rows.map(parseEntry) });
};

export const getRandomMemory = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;

  const result = await db.execute({
    sql: `SELECT * FROM entries 
          WHERE user_id = ? 
          AND (is_time_capsule = 0 OR (is_time_capsule = 1 AND unlock_at <= datetime('now')))
          ORDER BY RANDOM() LIMIT 1`,
    args: [userId]
  });

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Belum ada memory' });
    return;
  }

  res.json({ entry: parseEntry(result.rows[0]) });
};

export const setPin = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const id = String(req.params.id);
  const { pin } = req.body;

  const result = await db.execute({
    sql: 'SELECT * FROM entries WHERE id = ? AND user_id = ?',
    args: [id, userId]
  });

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Entry tidak ditemukan' });
    return;
  }

  const pinHash = bcrypt.hashSync(pin, 10);
  await db.execute({
    sql: 'UPDATE entries SET is_private = 1, pin_hash = ? WHERE id = ?',
    args: [pinHash, id]
  });

  res.json({ message: 'PIN berhasil dipasang!' });
};

export const verifyPin = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const id = String(req.params.id);
  const { pin } = req.body;

  const result = await db.execute({
    sql: 'SELECT * FROM entries WHERE id = ? AND user_id = ?',
    args: [id, userId]
  });

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Entry tidak ditemukan' });
    return;
  }

  const entry = result.rows[0] as any;

  if (!entry.pin_hash) {
    res.status(400).json({ error: 'Entry ini tidak memiliki PIN' });
    return;
  }

  const valid = bcrypt.compareSync(pin, entry.pin_hash as string);
  if (!valid) {
    res.status(401).json({ error: 'PIN salah' });
    return;
  }

  res.json({
    message: 'PIN benar!',
    entry: { ...parseEntry(entry), pin_hash: undefined }
  });
};

export const getVersions = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const id = String(req.params.id);

  const result = await db.execute({
    sql: `SELECT * FROM entry_versions WHERE entry_id = ? AND user_id = ? ORDER BY version_number DESC`,
    args: [id, userId]
  });

  res.json({ versions: result.rows });
};

export const rollbackVersion = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const id = String(req.params.id);
  const versionId = String(req.params.versionId);

  const result = await db.execute({
    sql: 'SELECT * FROM entry_versions WHERE id = ? AND entry_id = ? AND user_id = ?',
    args: [versionId, id, userId]
  });

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Versi tidak ditemukan' });
    return;
  }

  const version = result.rows[0] as any;

  await db.execute({
    sql: `UPDATE entries SET title = ?, content = ?, mood = ?, mood_label = ?, tags = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    args: [version.title, version.content, version.mood, version.mood_label, version.tags, id, userId]
  });

  await logActivity(userId, 'entry.update', 'entry', id, { rollback_to_version: version.version_number });
  logger.info('Entry rolled back', { userId, entryId: id, version: version.version_number });
  res.json({ message: `Berhasil rollback ke versi ${version.version_number}!` });
};