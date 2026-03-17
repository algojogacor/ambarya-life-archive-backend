// backend/src/controllers/social.controller.ts

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { logActivity } from '../services/activity.service';
import logger from '../services/logger.service';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// Fix: req.query bisa return string | string[] | ParsedQs, libsql hanya mau string
const qs = (val: unknown): string | undefined => {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return undefined;
};

const parsePost = (row: any) => ({
  ...row,
  media: JSON.parse((row.media as string) || '[]'),
});

// ─── PROFILE ─────────────────────────────────────────────────────────────────

export const getProfile = async (req: Request, res: Response): Promise<void> => {
  const username = req.params.username;
  const result = await db.execute({
    sql: `SELECT sp.*, u.name, u.email,
            (SELECT COUNT(*) FROM follows WHERE following_id = sp.user_id) as followers_count,
            (SELECT COUNT(*) FROM follows WHERE follower_id = sp.user_id) as following_count,
            (SELECT COUNT(*) FROM feed_posts WHERE user_id = sp.user_id) as posts_count
          FROM social_profiles sp
          JOIN users u ON u.id = sp.user_id
          WHERE sp.username = ?`,
    args: [username]
  });
  if (result.rows.length === 0) { res.status(404).json({ error: 'Profil tidak ditemukan' }); return; }
  res.json({ profile: result.rows[0] });
};

export const getMyProfile = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as string;
  const result = await db.execute({
    sql: `SELECT sp.*, u.name, u.email,
            (SELECT COUNT(*) FROM follows WHERE following_id = sp.user_id) as followers_count,
            (SELECT COUNT(*) FROM follows WHERE follower_id = sp.user_id) as following_count,
            (SELECT COUNT(*) FROM feed_posts WHERE user_id = sp.user_id) as posts_count
          FROM social_profiles sp
          JOIN users u ON u.id = sp.user_id
          WHERE sp.user_id = ?`,
    args: [userId]
  });
  if (result.rows.length === 0) { res.status(404).json({ error: 'Profil belum dibuat' }); return; }
  res.json({ profile: result.rows[0] });
};

export const createOrUpdateProfile = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as string;
  const { username, display_name, bio, avatar_url } = req.body;
  if (!username) { res.status(400).json({ error: 'Username wajib diisi' }); return; }

  const existing = await db.execute({
    sql: 'SELECT user_id FROM social_profiles WHERE username = ? AND user_id != ?',
    args: [username as string, userId]
  });
  if (existing.rows.length > 0) { res.status(409).json({ error: 'Username sudah dipakai' }); return; }

  const check = await db.execute({
    sql: 'SELECT id FROM social_profiles WHERE user_id = ?',
    args: [userId]
  });

  if (check.rows.length === 0) {
    await db.execute({
      sql: `INSERT INTO social_profiles (id, user_id, username, display_name, bio, avatar_url) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [uuidv4(), userId, username as string, (display_name as string) || null, (bio as string) || null, (avatar_url as string) || null]
    });
  } else {
    await db.execute({
      sql: `UPDATE social_profiles SET username = ?, display_name = ?, bio = ?, avatar_url = ? WHERE user_id = ?`,
      args: [username as string, (display_name as string) || null, (bio as string) || null, (avatar_url as string) || null, userId]
    });
  }

  const updated = await db.execute({ sql: 'SELECT * FROM social_profiles WHERE user_id = ?', args: [userId] });
  res.json({ message: 'Profil berhasil disimpan!', profile: updated.rows[0] });
};

export const searchUsers = async (req: Request, res: Response): Promise<void> => {
  const q = qs(req.query.q);
  if (!q) { res.status(400).json({ error: 'Query wajib diisi' }); return; }
  const result = await db.execute({
    sql: `SELECT sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
            (SELECT COUNT(*) FROM follows WHERE following_id = sp.user_id) as followers_count
          FROM social_profiles sp WHERE sp.username LIKE ? OR sp.display_name LIKE ? LIMIT 20`,
    args: [`%${q}%`, `%${q}%`]
  });
  res.json({ users: result.rows });
};

// ─── FOLLOW ───────────────────────────────────────────────────────────────────

export const followUser = async (req: Request, res: Response): Promise<void> => {
  const followerId = (req as any).user.id as string;
  const username = req.params.username;
  const target = await db.execute({
    sql: 'SELECT user_id FROM social_profiles WHERE username = ?',
    args: [username]
  });
  if (target.rows.length === 0) { res.status(404).json({ error: 'User tidak ditemukan' }); return; }
  const followingId = target.rows[0].user_id as string;
  if (followerId === followingId) { res.status(400).json({ error: 'Tidak bisa follow diri sendiri' }); return; }
  try {
    await db.execute({
      sql: 'INSERT INTO follows (id, follower_id, following_id) VALUES (?, ?, ?)',
      args: [uuidv4(), followerId, followingId]
    });
    await db.execute({
      sql: `INSERT INTO social_notifications (id, user_id, actor_id, type) VALUES (?, ?, ?, 'follow')`,
      args: [uuidv4(), followingId, followerId]
    });
    await logActivity(followerId, 'social.follow', 'user', followingId);
    res.json({ message: 'Berhasil follow!' });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) { res.status(409).json({ error: 'Sudah follow user ini' }); }
    else throw e;
  }
};

export const unfollowUser = async (req: Request, res: Response): Promise<void> => {
  const followerId = (req as any).user.id as string;
  const username = req.params.username;
  const target = await db.execute({
    sql: 'SELECT user_id FROM social_profiles WHERE username = ?',
    args: [username]
  });
  if (target.rows.length === 0) { res.status(404).json({ error: 'User tidak ditemukan' }); return; }
  await db.execute({
    sql: 'DELETE FROM follows WHERE follower_id = ? AND following_id = ?',
    args: [followerId, target.rows[0].user_id as string]
  });
  res.json({ message: 'Berhasil unfollow!' });
};

export const getFollowers = async (req: Request, res: Response): Promise<void> => {
  const username = req.params.username;
  const target = await db.execute({
    sql: 'SELECT user_id FROM social_profiles WHERE username = ?',
    args: [username]
  });
  if (target.rows.length === 0) { res.status(404).json({ error: 'User tidak ditemukan' }); return; }
  const result = await db.execute({
    sql: `SELECT sp.username, sp.display_name, sp.avatar_url, sp.is_bot
          FROM follows f JOIN social_profiles sp ON sp.user_id = f.follower_id
          WHERE f.following_id = ? ORDER BY f.created_at DESC`,
    args: [target.rows[0].user_id as string]
  });
  res.json({ followers: result.rows });
};

export const getFollowing = async (req: Request, res: Response): Promise<void> => {
  const username = req.params.username;
  const target = await db.execute({
    sql: 'SELECT user_id FROM social_profiles WHERE username = ?',
    args: [username]
  });
  if (target.rows.length === 0) { res.status(404).json({ error: 'User tidak ditemukan' }); return; }
  const result = await db.execute({
    sql: `SELECT sp.username, sp.display_name, sp.avatar_url, sp.is_bot
          FROM follows f JOIN social_profiles sp ON sp.user_id = f.following_id
          WHERE f.follower_id = ? ORDER BY f.created_at DESC`,
    args: [target.rows[0].user_id as string]
  });
  res.json({ following: result.rows });
};

// ─── FEED ─────────────────────────────────────────────────────────────────────

export const getFeed = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as string;
  const cursor = qs(req.query.cursor);              // ✅ Fix: pakai helper qs()
  const limitNum = Number(qs(req.query.limit)) || 20; // ✅ Fix: pakai helper qs()

  let result;
  if (cursor) {
    result = await db.execute({
      sql: `SELECT fp.*, sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
              (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) as reactions_count,
              (SELECT COUNT(*) FROM comments WHERE post_id = fp.id) as comments_count,
              (SELECT type FROM reactions WHERE post_id = fp.id AND user_id = ?) as my_reaction
            FROM feed_posts fp JOIN social_profiles sp ON sp.user_id = fp.user_id
            WHERE (fp.user_id = ? OR fp.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR (fp.is_bot_post = 1 AND fp.visibility = 'public'))
            AND fp.visibility != 'private' AND fp.created_at < ?
            ORDER BY fp.created_at DESC LIMIT ?`,
      args: [userId, userId, userId, cursor, limitNum]
    });
  } else {
    result = await db.execute({
      sql: `SELECT fp.*, sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
              (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) as reactions_count,
              (SELECT COUNT(*) FROM comments WHERE post_id = fp.id) as comments_count,
              (SELECT type FROM reactions WHERE post_id = fp.id AND user_id = ?) as my_reaction
            FROM feed_posts fp JOIN social_profiles sp ON sp.user_id = fp.user_id
            WHERE (fp.user_id = ? OR fp.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR (fp.is_bot_post = 1 AND fp.visibility = 'public'))
            AND fp.visibility != 'private'
            ORDER BY fp.created_at DESC LIMIT ?`,
      args: [userId, userId, userId, limitNum]
    });
  }

  const posts = result.rows.map(parsePost);
  const nextCursor = posts.length === limitNum ? (posts[posts.length - 1] as any).created_at as string : null;
  res.json({ posts, next_cursor: nextCursor });
};

export const getPublicFeed = async (req: Request, res: Response): Promise<void> => {
  const cursor = qs(req.query.cursor);
  const limitNum = Number(qs(req.query.limit)) || 20;

  let result;
  if (cursor) {
    result = await db.execute({
      sql: `SELECT fp.*, sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
              (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) as reactions_count,
              (SELECT COUNT(*) FROM comments WHERE post_id = fp.id) as comments_count
            FROM feed_posts fp JOIN social_profiles sp ON sp.user_id = fp.user_id
            WHERE fp.visibility = 'public' AND fp.created_at < ?
            ORDER BY fp.created_at DESC LIMIT ?`,
      args: [cursor, limitNum]
    });
  } else {
    result = await db.execute({
      sql: `SELECT fp.*, sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
              (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) as reactions_count,
              (SELECT COUNT(*) FROM comments WHERE post_id = fp.id) as comments_count
            FROM feed_posts fp JOIN social_profiles sp ON sp.user_id = fp.user_id
            WHERE fp.visibility = 'public'
            ORDER BY fp.created_at DESC LIMIT ?`,
      args: [limitNum]
    });
  }

  const posts = result.rows.map(parsePost);
  const nextCursor = posts.length === limitNum ? (posts[posts.length - 1] as any).created_at as string : null;
  res.json({ posts, next_cursor: nextCursor });
};

export const createPost = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as string;
  const content = req.body.content as string | undefined;
  const media = req.body.media as any[] | undefined;
  const visibility = (req.body.visibility as string) || 'public';
  const entryId = req.body.entry_id as string | undefined;

  if (!content && (!media || media.length === 0) && !entryId) {
    res.status(400).json({ error: 'Konten tidak boleh kosong' }); return;
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO feed_posts (id, user_id, entry_id, content, media, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, userId, entryId || null, content || null, JSON.stringify(media || []), visibility, now]
  });
  await logActivity(userId, 'social.post', 'feed_post', id);
  logger.info('Feed post created', { userId, postId: id });
  const post = await db.execute({ sql: 'SELECT * FROM feed_posts WHERE id = ?', args: [id] });
  res.status(201).json({ message: 'Post berhasil dibuat!', post: parsePost(post.rows[0]) });
};

export const deletePost = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as string;
  const id = req.params.id;
  const result = await db.execute({
    sql: 'SELECT * FROM feed_posts WHERE id = ? AND user_id = ?',
    args: [id, userId]
  });
  if (result.rows.length === 0) { res.status(404).json({ error: 'Post tidak ditemukan' }); return; }
  await db.execute({ sql: 'DELETE FROM comments WHERE post_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM reactions WHERE post_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM feed_posts WHERE id = ?', args: [id] });
  await logActivity(userId, 'social.post_delete', 'feed_post', id);
  res.json({ message: 'Post berhasil dihapus!' });
};

// ─── REACTIONS ────────────────────────────────────────────────────────────────

export const reactToPost = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as string;
  const id = req.params.id;
  const type = (req.body.type as string) || 'like';

  const post = await db.execute({ sql: 'SELECT * FROM feed_posts WHERE id = ?', args: [id] });
  if (post.rows.length === 0) { res.status(404).json({ error: 'Post tidak ditemukan' }); return; }

  const existing = await db.execute({
    sql: 'SELECT * FROM reactions WHERE user_id = ? AND post_id = ?',
    args: [userId, id]
  });

  if (existing.rows.length > 0) {
    if ((existing.rows[0] as any).type === type) {
      await db.execute({ sql: 'DELETE FROM reactions WHERE user_id = ? AND post_id = ?', args: [userId, id] });
      res.json({ message: 'Reaction dihapus', reacted: false }); return;
    } else {
      await db.execute({ sql: 'UPDATE reactions SET type = ? WHERE user_id = ? AND post_id = ?', args: [type, userId, id] });
      res.json({ message: 'Reaction diupdate', reacted: true, type }); return;
    }
  }

  await db.execute({
    sql: 'INSERT INTO reactions (id, user_id, post_id, type) VALUES (?, ?, ?, ?)',
    args: [uuidv4(), userId, id, type]
  });
  const postOwnerId = post.rows[0].user_id as string;
  if (postOwnerId !== userId) {
    await db.execute({
      sql: `INSERT INTO social_notifications (id, user_id, actor_id, type, post_id) VALUES (?, ?, ?, 'reaction', ?)`,
      args: [uuidv4(), postOwnerId, userId, id]
    });
  }
  await logActivity(userId, 'social.react', 'feed_post', id);
  res.json({ message: 'Reaction ditambahkan!', reacted: true, type });
};

// ─── COMMENTS ────────────────────────────────────────────────────────────────

export const getComments = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  const result = await db.execute({
    sql: `SELECT c.*, sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
            (SELECT COUNT(*) FROM comments WHERE parent_id = c.id) as replies_count
          FROM comments c JOIN social_profiles sp ON sp.user_id = c.user_id
          WHERE c.post_id = ? AND c.parent_id IS NULL ORDER BY c.created_at ASC`,
    args: [id]
  });
  res.json({ comments: result.rows });
};

export const getReplies = async (req: Request, res: Response): Promise<void> => {
  const commentId = req.params.commentId;
  const result = await db.execute({
    sql: `SELECT c.*, sp.username, sp.display_name, sp.avatar_url, sp.is_bot
          FROM comments c JOIN social_profiles sp ON sp.user_id = c.user_id
          WHERE c.parent_id = ? ORDER BY c.created_at ASC`,
    args: [commentId]
  });
  res.json({ replies: result.rows });
};

export const addComment = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as string;
  const id = req.params.id;
  const content = req.body.content as string | undefined;
  const parentId = req.body.parent_id as string | undefined;

  if (!content) { res.status(400).json({ error: 'Komentar tidak boleh kosong' }); return; }

  const post = await db.execute({ sql: 'SELECT * FROM feed_posts WHERE id = ?', args: [id] });
  if (post.rows.length === 0) { res.status(404).json({ error: 'Post tidak ditemukan' }); return; }

  const commentId = uuidv4();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO comments (id, user_id, post_id, content, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [commentId, userId, id, content, parentId || null, now]
  });

  const postOwnerId = post.rows[0].user_id as string;
  if (postOwnerId !== userId) {
    await db.execute({
      sql: `INSERT INTO social_notifications (id, user_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, 'comment', ?, ?)`,
      args: [uuidv4(), postOwnerId, userId, id, commentId]
    });
  }

  if (parentId) {
    const parentComment = await db.execute({ sql: 'SELECT user_id FROM comments WHERE id = ?', args: [parentId] });
    const parentOwnerId = parentComment.rows[0]?.user_id as string | undefined;
    if (parentOwnerId && parentOwnerId !== userId) {
      await db.execute({
        sql: `INSERT INTO social_notifications (id, user_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, 'reply', ?, ?)`,
        args: [uuidv4(), parentOwnerId, userId, id, commentId]
      });
    }
  }

  await logActivity(userId, 'social.comment', 'feed_post', id);

  const comment = await db.execute({
    sql: `SELECT c.*, sp.username, sp.display_name, sp.avatar_url
          FROM comments c JOIN social_profiles sp ON sp.user_id = c.user_id WHERE c.id = ?`,
    args: [commentId]
  });
  res.status(201).json({ message: 'Komentar ditambahkan!', comment: comment.rows[0] });
};

export const deleteComment = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as string;
  const commentId = req.params.commentId;
  const result = await db.execute({
    sql: 'SELECT * FROM comments WHERE id = ? AND user_id = ?',
    args: [commentId, userId]
  });
  if (result.rows.length === 0) { res.status(404).json({ error: 'Komentar tidak ditemukan' }); return; }
  await db.execute({ sql: 'DELETE FROM comments WHERE parent_id = ?', args: [commentId] });
  await db.execute({ sql: 'DELETE FROM comments WHERE id = ?', args: [commentId] });
  await logActivity(userId, 'social.comment_delete', 'comment', commentId);
  res.json({ message: 'Komentar dihapus!' });
};

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

export const getNotifications = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as string;
  const result = await db.execute({
    sql: `SELECT sn.*, sp.username as actor_username, sp.display_name as actor_display_name, sp.avatar_url as actor_avatar
          FROM social_notifications sn JOIN social_profiles sp ON sp.user_id = sn.actor_id
          WHERE sn.user_id = ? ORDER BY sn.created_at DESC LIMIT 50`,
    args: [userId]
  });
  res.json({ notifications: result.rows });
};

export const markNotificationsRead = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as string;
  await db.execute({ sql: 'UPDATE social_notifications SET is_read = 1 WHERE user_id = ?', args: [userId] });
  res.json({ message: 'Notifikasi ditandai sudah dibaca' });
};

// ─── SHARE ENTRY TO FEED ──────────────────────────────────────────────────────

export const shareEntryToFeed = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id as string;
  const entryId = req.params.entry_id;
  const visibility = (req.body.visibility as string) || 'public';

  const entry = await db.execute({
    sql: 'SELECT * FROM entries WHERE id = ? AND user_id = ?',
    args: [entryId, userId]
  });
  if (entry.rows.length === 0) { res.status(404).json({ error: 'Entry tidak ditemukan' }); return; }

  const e = entry.rows[0] as any;
  const id = uuidv4();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO feed_posts (id, user_id, entry_id, content, media, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, userId, entryId, (e.content as string) || (e.title as string) || null, (e.media as string) || '[]', visibility, now]
  });
  await db.execute({ sql: 'UPDATE entries SET visibility = ? WHERE id = ?', args: [visibility, entryId] });
  await logActivity(userId, 'social.post', 'feed_post', id);
  res.status(201).json({ message: 'Entry berhasil di-share ke feed!' });
};