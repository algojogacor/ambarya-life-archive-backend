// backend/src/controllers/social.controller.ts

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { InValue } from '@libsql/client';
import db from '../db/database';
import { uploadToCloudinary } from '../services/cloudinary.service';
import { compressImage } from '../services/compress.service';
import { logActivity } from '../services/activity.service';
import logger from '../services/logger.service';

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

// ─── PROFILE ─────────────────────────────────────────────────────────────────

export const getProfile = async (req: Request, res: Response): Promise<void> => {
  const username = str(req.params.username);
  const result = await db.execute({
    sql: `SELECT sp.*, u.name, u.email,
            (SELECT COUNT(*) FROM follows WHERE following_id = sp.user_id) as followers_count,
            (SELECT COUNT(*) FROM follows WHERE follower_id = sp.user_id) as following_count,
            (SELECT COUNT(*) FROM feed_posts WHERE user_id = sp.user_id) as posts_count
          FROM social_profiles sp
          JOIN users u ON u.id = sp.user_id
          WHERE sp.username = ?`,
    args: [a(username)]
  });
  if (result.rows.length === 0) { res.status(404).json({ error: 'Profil tidak ditemukan' }); return; }
  res.json({ profile: result.rows[0] });
};

export const getMyProfile = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  const result = await db.execute({
    sql: `SELECT sp.*, u.name, u.email,
            (SELECT COUNT(*) FROM follows WHERE following_id = sp.user_id) as followers_count,
            (SELECT COUNT(*) FROM follows WHERE follower_id = sp.user_id) as following_count,
            (SELECT COUNT(*) FROM feed_posts WHERE user_id = sp.user_id) as posts_count
          FROM social_profiles sp
          JOIN users u ON u.id = sp.user_id
          WHERE sp.user_id = ?`,
    args: [a(userId)]
  });
  if (result.rows.length === 0) { res.status(404).json({ error: 'Profil belum dibuat' }); return; }
  res.json({ profile: result.rows[0] });
};

export const createOrUpdateProfile = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  const { username, display_name, bio, avatar_url } = req.body;
  if (!username) { res.status(400).json({ error: 'Username wajib diisi' }); return; }

  const existing = await db.execute({
    sql: 'SELECT user_id FROM social_profiles WHERE username = ? AND user_id != ?',
    args: [a(username), a(userId)]
  });
  if (existing.rows.length > 0) { res.status(409).json({ error: 'Username sudah dipakai' }); return; }

  const check = await db.execute({ sql: 'SELECT id FROM social_profiles WHERE user_id = ?', args: [a(userId)] });

  if (check.rows.length === 0) {
    await db.execute({
      sql: `INSERT INTO social_profiles (id, user_id, username, display_name, bio, avatar_url) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [a(uuidv4()), a(userId), a(username), a(display_name || null), a(bio || null), a(avatar_url || null)]
    });
  } else {
    await db.execute({
      sql: `UPDATE social_profiles SET username = ?, display_name = ?, bio = ?, avatar_url = ? WHERE user_id = ?`,
      args: [a(username), a(display_name || null), a(bio || null), a(avatar_url || null), a(userId)]
    });
  }

  const updated = await db.execute({ sql: 'SELECT * FROM social_profiles WHERE user_id = ?', args: [a(userId)] });
  res.json({ message: 'Profil berhasil disimpan!', profile: updated.rows[0] });
};

export const searchUsers = async (req: Request, res: Response): Promise<void> => {
  const q = qs(req.query.q);
  if (!q) { res.status(400).json({ error: 'Query wajib diisi' }); return; }
  const result = await db.execute({
    sql: `SELECT sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
            (SELECT COUNT(*) FROM follows WHERE following_id = sp.user_id) as followers_count
          FROM social_profiles sp WHERE sp.username LIKE ? OR sp.display_name LIKE ? LIMIT 20`,
    args: [a(`%${q}%`), a(`%${q}%`)]
  });
  res.json({ users: result.rows });
};

// ─── FOLLOW ───────────────────────────────────────────────────────────────────

export const followUser = async (req: Request, res: Response): Promise<void> => {
  const followerId = str((req as any).user.id);
  const username = str(req.params.username);
  const target = await db.execute({ sql: 'SELECT user_id FROM social_profiles WHERE username = ?', args: [a(username)] });
  if (target.rows.length === 0) { res.status(404).json({ error: 'User tidak ditemukan' }); return; }
  const followingId = str(target.rows[0].user_id);
  if (followerId === followingId) { res.status(400).json({ error: 'Tidak bisa follow diri sendiri' }); return; }
  try {
    await db.execute({ sql: 'INSERT INTO follows (id, follower_id, following_id) VALUES (?, ?, ?)', args: [a(uuidv4()), a(followerId), a(followingId)] });
    await db.execute({ sql: `INSERT INTO social_notifications (id, user_id, actor_id, type) VALUES (?, ?, ?, 'follow')`, args: [a(uuidv4()), a(followingId), a(followerId)] });
    await logActivity(followerId, 'social.follow', 'user', followingId);
    res.json({ message: 'Berhasil follow!' });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) { res.status(409).json({ error: 'Sudah follow user ini' }); }
    else throw e;
  }
};

export const unfollowUser = async (req: Request, res: Response): Promise<void> => {
  const followerId = str((req as any).user.id);
  const username = str(req.params.username);
  const target = await db.execute({ sql: 'SELECT user_id FROM social_profiles WHERE username = ?', args: [a(username)] });
  if (target.rows.length === 0) { res.status(404).json({ error: 'User tidak ditemukan' }); return; }
  const followingId = str(target.rows[0].user_id);
  await db.execute({ sql: 'DELETE FROM follows WHERE follower_id = ? AND following_id = ?', args: [a(followerId), a(followingId)] });
  await logActivity(followerId, 'social.unfollow', 'user', followingId);
  res.json({ message: 'Berhasil unfollow!' });
};

export const getFollowers = async (req: Request, res: Response): Promise<void> => {
  const username = str(req.params.username);
  const target = await db.execute({ sql: 'SELECT user_id FROM social_profiles WHERE username = ?', args: [a(username)] });
  if (target.rows.length === 0) { res.status(404).json({ error: 'User tidak ditemukan' }); return; }
  const result = await db.execute({
    sql: `SELECT sp.username, sp.display_name, sp.avatar_url, sp.is_bot FROM follows f JOIN social_profiles sp ON sp.user_id = f.follower_id WHERE f.following_id = ? ORDER BY f.created_at DESC`,
    args: [a(str(target.rows[0].user_id))]
  });
  res.json({ followers: result.rows });
};

export const getFollowing = async (req: Request, res: Response): Promise<void> => {
  const username = str(req.params.username);
  const target = await db.execute({ sql: 'SELECT user_id FROM social_profiles WHERE username = ?', args: [a(username)] });
  if (target.rows.length === 0) { res.status(404).json({ error: 'User tidak ditemukan' }); return; }
  const result = await db.execute({
    sql: `SELECT sp.username, sp.display_name, sp.avatar_url, sp.is_bot FROM follows f JOIN social_profiles sp ON sp.user_id = f.following_id WHERE f.follower_id = ? ORDER BY f.created_at DESC`,
    args: [a(str(target.rows[0].user_id))]
  });
  res.json({ following: result.rows });
};

// ─── FEED ─────────────────────────────────────────────────────────────────────

export const getFeed = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  const cursor = qs(req.query.cursor);
  const limitNum = Number(qs(req.query.limit) || '20');

  let result;
  if (cursor) {
    result = await db.execute({
      sql: `SELECT fp.*, sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
              (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) as reactions_count,
              (SELECT COUNT(*) FROM comments  WHERE post_id = fp.id) as comments_count,
              (SELECT type    FROM reactions WHERE post_id = fp.id AND user_id = ?) as my_reaction
            FROM feed_posts fp
            JOIN social_profiles sp ON sp.user_id = fp.user_id
            WHERE fp.visibility = 'public'
              AND fp.created_at < ?
            ORDER BY fp.created_at DESC
            LIMIT ?`,
      args: [a(userId), a(cursor), a(limitNum)]
    });
  } else {
    result = await db.execute({
      sql: `SELECT fp.*, sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
              (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) as reactions_count,
              (SELECT COUNT(*) FROM comments  WHERE post_id = fp.id) as comments_count,
              (SELECT type    FROM reactions WHERE post_id = fp.id AND user_id = ?) as my_reaction
            FROM feed_posts fp
            JOIN social_profiles sp ON sp.user_id = fp.user_id
            WHERE fp.visibility = 'public'
            ORDER BY fp.created_at DESC
            LIMIT ?`,
      args: [a(userId), a(limitNum)]
    });
  }

  const posts = result.rows.map(parsePost);
  const nextCursor = posts.length === limitNum
    ? str((posts[posts.length - 1] as any).created_at)
    : null;
  res.json({ posts, next_cursor: nextCursor });
};

export const getPublicFeed = async (req: Request, res: Response): Promise<void> => {
  const cursor = qs(req.query.cursor);
  const limitNum = Number(qs(req.query.limit) || '20');

  let result;
  if (cursor) {
    result = await db.execute({
      sql: `SELECT fp.*, sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
              (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) as reactions_count,
              (SELECT COUNT(*) FROM comments WHERE post_id = fp.id) as comments_count
            FROM feed_posts fp JOIN social_profiles sp ON sp.user_id = fp.user_id
            WHERE fp.visibility = 'public' AND fp.created_at < ? ORDER BY fp.created_at DESC LIMIT ?`,
      args: [a(cursor), a(limitNum)]
    });
  } else {
    result = await db.execute({
      sql: `SELECT fp.*, sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
              (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) as reactions_count,
              (SELECT COUNT(*) FROM comments WHERE post_id = fp.id) as comments_count
            FROM feed_posts fp JOIN social_profiles sp ON sp.user_id = fp.user_id
            WHERE fp.visibility = 'public' ORDER BY fp.created_at DESC LIMIT ?`,
      args: [a(limitNum)]
    });
  }

  const posts = result.rows.map(parsePost);
  const nextCursor = posts.length === limitNum ? str((posts[posts.length - 1] as any).created_at) : null;
  res.json({ posts, next_cursor: nextCursor });
};

export const createPost = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  const { content, media, visibility, entry_id } = req.body;

  if (!content && (!media || media.length === 0) && !entry_id) {
    res.status(400).json({ error: 'Konten tidak boleh kosong' }); return;
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO feed_posts (id, user_id, entry_id, content, media, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [a(id), a(userId), a(entry_id || null), a(content || null), a(JSON.stringify(media || [])), a(visibility || 'public'), a(now)]
  });
  await logActivity(userId, 'social.post', 'feed_post', id);
  logger.info('Feed post created', { userId, postId: id });
  const post = await db.execute({ sql: 'SELECT * FROM feed_posts WHERE id = ?', args: [a(id)] });
  res.status(201).json({ message: 'Post berhasil dibuat!', post: parsePost(post.rows[0]) });
};

// ─── UPLOAD MEDIA KE FEED POST ────────────────────────────────────────────────

export const uploadPostMedia = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  const id = str(req.params.id);

  const postResult = await db.execute({
    sql: 'SELECT * FROM feed_posts WHERE id = ? AND user_id = ?',
    args: [a(id), a(userId)]
  });

  if (postResult.rows.length === 0) {
    res.status(404).json({ error: 'Post tidak ditemukan' }); return;
  }

  const post = postResult.rows[0] as any;
  const files = req.files as Express.Multer.File[];

  if (!files || files.length === 0) {
    res.status(400).json({ error: 'Tidak ada file yang diupload' }); return;
  }

  const uploaded: any[] = [];

  for (const file of files) {
    const subfolder = file.mimetype.startsWith('image/') ? 'photos'
      : file.mimetype.startsWith('video/') ? 'videos'
      : 'others';

    try {
      const { buffer } = await compressImage(file.buffer, file.mimetype);
      const { fileId, webViewLink } = await uploadToCloudinary(buffer, subfolder);
      uploaded.push({
        fileId,
        url: webViewLink,
        type: subfolder,
        name: file.originalname,
        size: buffer.length,
      });
    } catch (err) {
      logger.error('Post media upload failed', { userId, postId: id, filename: file.originalname, err });
      throw err;
    }
  }

  const existingMedia = JSON.parse((post.media as string) || '[]');
  const newMedia = [...existingMedia, ...uploaded];
  await db.execute({
    sql: 'UPDATE feed_posts SET media = ? WHERE id = ?',
    args: [a(JSON.stringify(newMedia)), a(id)]
  });

  res.json({ message: 'Media berhasil diupload!', media: newMedia });
};

export const deletePost = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  const id = str(req.params.id);
  const result = await db.execute({ sql: 'SELECT * FROM feed_posts WHERE id = ? AND user_id = ?', args: [a(id), a(userId)] });
  if (result.rows.length === 0) { res.status(404).json({ error: 'Post tidak ditemukan' }); return; }
  await db.execute({ sql: 'DELETE FROM comments WHERE post_id = ?', args: [a(id)] });
  await db.execute({ sql: 'DELETE FROM reactions WHERE post_id = ?', args: [a(id)] });
  await db.execute({ sql: 'DELETE FROM feed_posts WHERE id = ?', args: [a(id)] });
  await logActivity(userId, 'social.post_delete', 'feed_post', id);
  res.json({ message: 'Post berhasil dihapus!' });
};

// ─── REACTIONS ────────────────────────────────────────────────────────────────

export const reactToPost = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  const id = str(req.params.id);
  const type = str(req.body.type) || 'like';
  const post = await db.execute({ sql: 'SELECT * FROM feed_posts WHERE id = ?', args: [a(id)] });
  if (post.rows.length === 0) { res.status(404).json({ error: 'Post tidak ditemukan' }); return; }
  const existing = await db.execute({ sql: 'SELECT * FROM reactions WHERE user_id = ? AND post_id = ?', args: [a(userId), a(id)] });
  if (existing.rows.length > 0) {
    if ((existing.rows[0] as any).type === type) {
      await db.execute({ sql: 'DELETE FROM reactions WHERE user_id = ? AND post_id = ?', args: [a(userId), a(id)] });
      res.json({ message: 'Reaction dihapus', reacted: false }); return;
    } else {
      await db.execute({ sql: 'UPDATE reactions SET type = ? WHERE user_id = ? AND post_id = ?', args: [a(type), a(userId), a(id)] });
      res.json({ message: 'Reaction diupdate', reacted: true, type }); return;
    }
  }
  await db.execute({ sql: 'INSERT INTO reactions (id, user_id, post_id, type) VALUES (?, ?, ?, ?)', args: [a(uuidv4()), a(userId), a(id), a(type)] });
  const postOwnerId = str(post.rows[0].user_id);
  if (postOwnerId !== userId) {
    await db.execute({ sql: `INSERT INTO social_notifications (id, user_id, actor_id, type, post_id) VALUES (?, ?, ?, 'reaction', ?)`, args: [a(uuidv4()), a(postOwnerId), a(userId), a(id)] });
  }
  await logActivity(userId, 'social.react', 'feed_post', id);
  res.json({ message: 'Reaction ditambahkan!', reacted: true, type });
};

// ─── COMMENTS ────────────────────────────────────────────────────────────────

export const getComments = async (req: Request, res: Response): Promise<void> => {
  const id = str(req.params.id);
  const result = await db.execute({
    sql: `SELECT c.*, sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
            (SELECT COUNT(*) FROM comments WHERE parent_id = c.id) as replies_count
          FROM comments c JOIN social_profiles sp ON sp.user_id = c.user_id
          WHERE c.post_id = ? AND c.parent_id IS NULL ORDER BY c.created_at ASC`,
    args: [a(id)]
  });
  res.json({ comments: result.rows });
};

export const getReplies = async (req: Request, res: Response): Promise<void> => {
  const commentId = str(req.params.commentId);
  const result = await db.execute({
    sql: `SELECT c.*, sp.username, sp.display_name, sp.avatar_url, sp.is_bot FROM comments c JOIN social_profiles sp ON sp.user_id = c.user_id WHERE c.parent_id = ? ORDER BY c.created_at ASC`,
    args: [a(commentId)]
  });
  res.json({ replies: result.rows });
};

export const addComment = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  const id = str(req.params.id);
  const content = str(req.body.content);
  const parentId = req.body.parent_id ? str(req.body.parent_id) : null;
  if (!content) { res.status(400).json({ error: 'Komentar tidak boleh kosong' }); return; }
  const post = await db.execute({ sql: 'SELECT * FROM feed_posts WHERE id = ?', args: [a(id)] });
  if (post.rows.length === 0) { res.status(404).json({ error: 'Post tidak ditemukan' }); return; }
  const commentId = uuidv4();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO comments (id, user_id, post_id, content, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [a(commentId), a(userId), a(id), a(content), a(parentId), a(now)]
  });
  const postOwnerId = str(post.rows[0].user_id);
  if (postOwnerId !== userId) {
    await db.execute({ sql: `INSERT INTO social_notifications (id, user_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, 'comment', ?, ?)`, args: [a(uuidv4()), a(postOwnerId), a(userId), a(id), a(commentId)] });
  }
  if (parentId) {
    const parentComment = await db.execute({ sql: 'SELECT user_id FROM comments WHERE id = ?', args: [a(parentId)] });
    const parentOwnerId = parentComment.rows[0] ? str(parentComment.rows[0].user_id) : null;
    if (parentOwnerId && parentOwnerId !== userId) {
      await db.execute({ sql: `INSERT INTO social_notifications (id, user_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, 'reply', ?, ?)`, args: [a(uuidv4()), a(parentOwnerId), a(userId), a(id), a(commentId)] });
    }
  }
  await logActivity(userId, 'social.comment', 'feed_post', id);
  const comment = await db.execute({
    sql: `SELECT c.*, sp.username, sp.display_name, sp.avatar_url FROM comments c JOIN social_profiles sp ON sp.user_id = c.user_id WHERE c.id = ?`,
    args: [a(commentId)]
  });
  res.status(201).json({ message: 'Komentar ditambahkan!', comment: comment.rows[0] });
};

export const deleteComment = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  const commentId = str(req.params.commentId);
  const result = await db.execute({ sql: 'SELECT * FROM comments WHERE id = ? AND user_id = ?', args: [a(commentId), a(userId)] });
  if (result.rows.length === 0) { res.status(404).json({ error: 'Komentar tidak ditemukan' }); return; }
  await db.execute({ sql: 'DELETE FROM comments WHERE parent_id = ?', args: [a(commentId)] });
  await db.execute({ sql: 'DELETE FROM comments WHERE id = ?', args: [a(commentId)] });
  await logActivity(userId, 'social.comment_delete', 'comment', commentId);
  res.json({ message: 'Komentar dihapus!' });
};

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

export const getNotifications = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  const result = await db.execute({
    sql: `SELECT sn.*, sp.username as actor_username, sp.display_name as actor_display_name, sp.avatar_url as actor_avatar FROM social_notifications sn JOIN social_profiles sp ON sp.user_id = sn.actor_id WHERE sn.user_id = ? ORDER BY sn.created_at DESC LIMIT 50`,
    args: [a(userId)]
  });
  res.json({ notifications: result.rows });
};

export const markNotificationsRead = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  await db.execute({ sql: 'UPDATE social_notifications SET is_read = 1 WHERE user_id = ?', args: [a(userId)] });
  res.json({ message: 'Notifikasi ditandai sudah dibaca' });
};

// ─── SHARE ENTRY TO FEED ──────────────────────────────────────────────────────

export const shareEntryToFeed = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  const entryId = str(req.params.entry_id);
  const visibility = str(req.body.visibility) || 'public';
  const entry = await db.execute({ sql: 'SELECT * FROM entries WHERE id = ? AND user_id = ?', args: [a(entryId), a(userId)] });
  if (entry.rows.length === 0) { res.status(404).json({ error: 'Entry tidak ditemukan' }); return; }
  const e = entry.rows[0] as any;
  const id = uuidv4();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO feed_posts (id, user_id, entry_id, content, media, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [a(id), a(userId), a(entryId), a(str(e.content) || str(e.title) || null), a(str(e.media) || '[]'), a(visibility), a(now)]
  });
  await db.execute({ sql: 'UPDATE entries SET visibility = ? WHERE id = ?', args: [a(visibility), a(entryId)] });
  await logActivity(userId, 'social.post', 'feed_post', id);
  res.status(201).json({ message: 'Entry berhasil di-share ke feed!' });
};