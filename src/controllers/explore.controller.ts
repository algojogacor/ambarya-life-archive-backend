// backend/src/controllers/explore.controller.ts

import { Request, Response } from 'express';
import type { InValue } from '@libsql/client';
import db from '../db/database';

// ─── TYPE-SAFE HELPERS ────────────────────────────────────────────────────────

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

const qs = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0] as string;
  return undefined;
};

const parsePost = (row: any) => ({
  ...row,
  media: JSON.parse((row.media as string) || '[]'),
});

// ─── EXPLORE FEED ─────────────────────────────────────────────────────────────

/**
 * GET /social/explore
 * Public posts dari semua user, diurutkan terbaru.
 * Mendukung cursor-based pagination via ?cursor=<created_at>
 */
export const getExploreFeed = async (req: Request, res: Response): Promise<void> => {
  const cursor  = qs(req.query.cursor);
  const limitNum = Math.min(Number(qs(req.query.limit) || '20'), 50);

  const userId = str((req as any).user.id);

  let result;

  if (cursor) {
    result = await db.execute({
      sql: `
        SELECT
          fp.*,
          sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
          (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) AS reactions_count,
          (SELECT COUNT(*) FROM comments  WHERE post_id = fp.id) AS comments_count,
          (SELECT type    FROM reactions WHERE post_id = fp.id AND user_id = ?) AS my_reaction
        FROM feed_posts fp
        JOIN social_profiles sp ON sp.user_id = fp.user_id
        WHERE fp.visibility = 'public'
          AND fp.created_at < ?
        ORDER BY fp.created_at DESC
        LIMIT ?
      `,
      args: [a(userId), a(cursor), a(limitNum)],
    });
  } else {
    result = await db.execute({
      sql: `
        SELECT
          fp.*,
          sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
          (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) AS reactions_count,
          (SELECT COUNT(*) FROM comments  WHERE post_id = fp.id) AS comments_count,
          (SELECT type    FROM reactions WHERE post_id = fp.id AND user_id = ?) AS my_reaction
        FROM feed_posts fp
        JOIN social_profiles sp ON sp.user_id = fp.user_id
        WHERE fp.visibility = 'public'
        ORDER BY fp.created_at DESC
        LIMIT ?
      `,
      args: [a(userId), a(limitNum)],
    });
  }

  const posts      = result.rows.map(parsePost);
  const nextCursor = posts.length === limitNum
    ? str((posts[posts.length - 1] as any).created_at)
    : null;

  res.json({ posts, next_cursor: nextCursor });
};

// ─── TRENDING POSTS ───────────────────────────────────────────────────────────

/**
 * GET /social/explore/trending
 * Post publik dengan reactions terbanyak dalam 7 hari terakhir.
 * Query param: ?days=7 (default 7, max 30) | ?limit=20
 */
export const getTrendingPosts = async (req: Request, res: Response): Promise<void> => {
  const days     = Math.min(Number(qs(req.query.days)  || '7'),  30);
  const limitNum = Math.min(Number(qs(req.query.limit) || '20'), 50);

  const userId = str((req as any).user.id);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const result = await db.execute({
    sql: `
      SELECT
        fp.*,
        sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
        COUNT(r.id)                                           AS reactions_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = fp.id) AS comments_count,
        (SELECT type FROM reactions WHERE post_id = fp.id AND user_id = ?) AS my_reaction
      FROM feed_posts fp
      JOIN social_profiles sp ON sp.user_id = fp.user_id
      LEFT JOIN reactions r ON r.post_id = fp.id
      WHERE fp.visibility = 'public'
        AND fp.created_at >= ?
      GROUP BY fp.id
      ORDER BY reactions_count DESC, fp.created_at DESC
      LIMIT ?
    `,
    args: [a(userId), a(since), a(limitNum)],
  });

  const posts = result.rows.map(parsePost);
  res.json({ posts, days, since });
};