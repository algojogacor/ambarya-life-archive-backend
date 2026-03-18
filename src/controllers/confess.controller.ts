// backend/src/controllers/confess.controller.ts

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { InValue } from '@libsql/client';
import db from '../db/database';
import {
  polishConfess,
  generateDisplayName,
  enqueueAIReply,
  MOOD_TAGS,
  MOOD_EMOJI,
  type MoodTag,
} from '../services/confess.service';
import logger from '../services/logger.service';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const a = (v: unknown): InValue => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return String(v);
};

const str = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return String(v);
};

// ─── GET CONFESS FEED ─────────────────────────────────────────────────────────

/**
 * GET /api/confess
 * Query: cursor? (created_at untuk pagination), limit?
 */
export const getConfessFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const cursor   = req.query.cursor as string | undefined;
    const limitNum = Math.min(Number(req.query.limit || 20), 50);
    const userId   = (req as any).user?.id ? str((req as any).user.id) : null;

    let rows;

    if (cursor) {
      const result = await db.execute({
        sql: `SELECT
                cp.*,
                CASE WHEN cr.user_id IS NOT NULL THEN 1 ELSE 0 END as has_related,
                (SELECT COUNT(*) FROM confess_comments cc WHERE cc.confess_id = cp.id) as comment_count
              FROM confess_posts cp
              LEFT JOIN confess_relates cr
                ON cr.confess_id = cp.id AND cr.user_id = ?
              WHERE cp.created_at < ?
              ORDER BY cp.created_at DESC
              LIMIT ?`,
        args: [a(userId), a(cursor), a(limitNum)],
      });
      rows = result.rows;
    } else {
      const result = await db.execute({
        sql: `SELECT
                cp.*,
                CASE WHEN cr.user_id IS NOT NULL THEN 1 ELSE 0 END as has_related,
                (SELECT COUNT(*) FROM confess_comments cc WHERE cc.confess_id = cp.id) as comment_count
              FROM confess_posts cp
              LEFT JOIN confess_relates cr
                ON cr.confess_id = cp.id AND cr.user_id = ?
              ORDER BY cp.created_at DESC
              LIMIT ?`,
        args: [a(userId), a(limitNum)],
      });
      rows = result.rows;
    }

    const posts      = rows as any[];
    const nextCursor = posts.length === limitNum
      ? str(posts[posts.length - 1].created_at)
      : null;

    res.json({
      posts: posts.map(_formatPost),
      next_cursor: nextCursor,
    });
  } catch (err) {
    logger.error('getConfessFeed failed', { err });
    res.status(500).json({ error: 'Gagal memuat Bisikan Jiwa' });
  }
};

// ─── GET CONFESS DETAIL ───────────────────────────────────────────────────────

/**
 * GET /api/confess/:id
 */
export const getConfessDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id }  = req.params;
    const userId  = (req as any).user?.id ? str((req as any).user.id) : null;

    const result = await db.execute({
      sql: `SELECT
              cp.*,
              CASE WHEN cr.user_id IS NOT NULL THEN 1 ELSE 0 END as has_related,
              (SELECT COUNT(*) FROM confess_comments cc WHERE cc.confess_id = cp.id) as comment_count
            FROM confess_posts cp
            LEFT JOIN confess_relates cr
              ON cr.confess_id = cp.id AND cr.user_id = ?
            WHERE cp.id = ?`,
      args: [a(userId), a(id)],
    });

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Cerita tidak ditemukan' });
      return;
    }

    res.json({ post: _formatPost(result.rows[0] as any) });
  } catch (err) {
    logger.error('getConfessDetail failed', { err });
    res.status(500).json({ error: 'Gagal memuat detail cerita' });
  }
};

// ─── SUBMIT CONFESS ───────────────────────────────────────────────────────────

/**
 * POST /api/confess
 * Body: { content, mood_tag }
 * Auth: required
 */
export const submitConfess = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId  = str((req as any).user.id);
    const { content, mood_tag } = req.body;

    if (!content || content.trim().length < 10) {
      res.status(400).json({ error: 'Cerita terlalu pendek. Tulis lebih banyak ya 🙏' });
      return;
    }

    // Validasi mood tag
    const mood = MOOD_TAGS.includes(mood_tag) ? mood_tag as MoodTag : 'sedih';

    // Ambil nama asli user untuk di-sensor
    const userResult = await db.execute({
      sql:  'SELECT name FROM users WHERE id = ?',
      args: [a(userId)],
    });
    const realName    = userResult.rows.length > 0
      ? str((userResult.rows[0] as any).name)
      : 'Seseorang';
    const displayName = generateDisplayName(realName);

    // AI polish — susun ulang agar lebih mengalir
    const polished = await polishConfess(content.trim());

    const postId = uuidv4();
    await db.execute({
      sql: `INSERT INTO confess_posts
              (id, user_id, original_content, polished_content, display_name, mood_tag, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [
        a(postId),
        a(userId),
        a(content.trim()),
        a(polished),
        a(displayName),
        a(mood),
      ],
    });

    logger.info('Confess: User submitted', { postId, mood });

    // Fetch post yang baru dibuat untuk response
    const created = await db.execute({
      sql:  'SELECT * FROM confess_posts WHERE id = ?',
      args: [a(postId)],
    });

    res.status(201).json({
      message: 'Ceritamu sudah terkirim 🤍',
      post: _formatPost(created.rows[0] as any),
    });
  } catch (err) {
    logger.error('submitConfess failed', { err });
    res.status(500).json({ error: 'Gagal mengirim cerita' });
  }
};

// ─── RELATE ───────────────────────────────────────────────────────────────────

/**
 * POST /api/confess/:id/relate
 * Toggle relate (seperti like)
 */
export const toggleRelate = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId    = str((req as any).user.id);
    const { id }    = req.params;

    // Cek post ada
    const postCheck = await db.execute({
      sql:  'SELECT id, relate_count FROM confess_posts WHERE id = ?',
      args: [a(id)],
    });
    if (postCheck.rows.length === 0) {
      res.status(404).json({ error: 'Cerita tidak ditemukan' });
      return;
    }

    const post = postCheck.rows[0] as any;

    // Cek sudah relate atau belum
    const existing = await db.execute({
      sql:  'SELECT id FROM confess_relates WHERE confess_id = ? AND user_id = ?',
      args: [a(id), a(userId)],
    });

    let related: boolean;
    let newCount: number;

    if (existing.rows.length > 0) {
      // Un-relate
      await db.execute({
        sql:  'DELETE FROM confess_relates WHERE confess_id = ? AND user_id = ?',
        args: [a(id), a(userId)],
      });
      newCount = Math.max(0, Number(post.relate_count) - 1);
      related  = false;
    } else {
      // Relate
      await db.execute({
        sql: `INSERT INTO confess_relates (id, confess_id, user_id, created_at)
              VALUES (?, ?, ?, datetime('now'))`,
        args: [a(uuidv4()), a(id), a(userId)],
      });
      newCount = Number(post.relate_count) + 1;
      related  = true;
    }

    // Update relate_count di post
    await db.execute({
      sql:  'UPDATE confess_posts SET relate_count = ? WHERE id = ?',
      args: [a(newCount), a(id)],
    });

    res.json({ related, relate_count: newCount });
  } catch (err) {
    logger.error('toggleRelate failed', { err });
    res.status(500).json({ error: 'Gagal' });
  }
};

// ─── GET COMMENTS ─────────────────────────────────────────────────────────────

/**
 * GET /api/confess/:id/comments
 */
export const getConfessComments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await db.execute({
      sql: `SELECT
              cc.*,
              sp.username as commenter_username,
              sp.display_name as commenter_display_name,
              sp.avatar_url as commenter_avatar
            FROM confess_comments cc
            LEFT JOIN social_profiles sp ON sp.user_id = cc.user_id
            WHERE cc.confess_id = ? AND cc.parent_id IS NULL
            ORDER BY cc.created_at ASC`,
      args: [a(id)],
    });

    const comments = (result.rows as any[]).map(c => ({
      id:           str(c.id),
      confess_id:   str(c.confess_id),
      content:      str(c.content),
      is_ai_reply:  c.is_ai_reply === 1,
      created_at:   str(c.created_at),
      // Kalau AI reply, tampilkan sebagai "Bisikan Jiwa"
      // Kalau user biasa, tampilkan anonymous "@anonim"
      commenter: c.is_ai_reply === 1
        ? { username: 'bisikanjiwa', display_name: '🤍 Bisikan Jiwa', avatar_url: null, is_ai: true }
        : { username: 'anonim', display_name: 'Anonim', avatar_url: null, is_ai: false },
    }));

    res.json({ comments });
  } catch (err) {
    logger.error('getConfessComments failed', { err });
    res.status(500).json({ error: 'Gagal memuat komentar' });
  }
};

// ─── ADD COMMENT ──────────────────────────────────────────────────────────────

/**
 * POST /api/confess/:id/comments
 * Body: { content }
 * Auth: required
 */
export const addConfessComment = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId     = str((req as any).user.id);
    const { id }     = req.params;
    const { content } = req.body;

    if (!content || content.trim().length < 1) {
      res.status(400).json({ error: 'Komentar tidak boleh kosong' });
      return;
    }

    // Cek post ada
    const postCheck = await db.execute({
      sql:  'SELECT id FROM confess_posts WHERE id = ?',
      args: [a(id)],
    });
    if (postCheck.rows.length === 0) {
      res.status(404).json({ error: 'Cerita tidak ditemukan' });
      return;
    }

    const commentId = uuidv4();
    await db.execute({
      sql: `INSERT INTO confess_comments (id, confess_id, user_id, content, is_ai_reply, created_at)
            VALUES (?, ?, ?, ?, 0, datetime('now'))`,
      args: [a(commentId), a(id), a(userId), a(content.trim())],
    });

    // Masukkan ke antrian AI reply (delay 2-5 menit)
    await enqueueAIReply(id, commentId);

    res.status(201).json({
      message: 'Komentar terkirim',
      comment: {
        id:         commentId,
        confess_id: id,
        content:    content.trim(),
        is_ai_reply: false,
        commenter:  { username: 'anonim', display_name: 'Anonim', avatar_url: null, is_ai: false },
        created_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error('addConfessComment failed', { err });
    res.status(500).json({ error: 'Gagal mengirim komentar' });
  }
};

// ─── GET MOOD TAGS ────────────────────────────────────────────────────────────

/**
 * GET /api/confess/moods
 * Publik — untuk dropdown di Flutter
 */
export const getMoodTags = (_req: Request, res: Response): void => {
  res.json({
    moods: MOOD_TAGS.map(tag => ({
      tag,
      emoji: MOOD_EMOJI[tag],
      label: _moodLabel(tag),
    })),
  });
};

// ─── HELPERS PRIVATE ──────────────────────────────────────────────────────────

const _formatPost = (row: any) => ({
  id:               str(row.id),
  display_name:     str(row.display_name),
  polished_content: str(row.polished_content),
  mood_tag:         str(row.mood_tag),
  mood_emoji:       MOOD_EMOJI[row.mood_tag as MoodTag] || '😔',
  relate_count:     Number(row.relate_count || 0),
  comment_count:    Number(row.comment_count || 0),
  has_related:      row.has_related === 1,
  is_bot_post:      row.is_bot_post === 1,
  ai_replied:       row.ai_replied === 1,
  created_at:       str(row.created_at),
});

const _moodLabel = (tag: string): string => {
  const labels: Record<string, string> = {
    sedih:   'Sedih',
    kesal:   'Kesal',
    bingung: 'Bingung',
    terharu: 'Terharu',
    cemas:   'Cemas',
  };
  return labels[tag] || tag;
};