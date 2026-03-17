import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { logActivity } from '../services/activity.service';
import logger from '../services/logger.service';

// ─── HELPER ──────────────────────────────────────────────────────────────────
const parsePost = (row: any) => ({
  ...row,
  media: JSON.parse((row.media as string) || '[]'),
});

// ─── PROFILE ─────────────────────────────────────────────────────────────────

export const getProfile = async (req: Request, res: Response): Promise<void> => {
  const { username } = req.params;

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

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Profil tidak ditemukan' });
    return;
  }

  res.json({ profile: result.rows[0] });
};

export const getMyProfile = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;

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

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Profil belum dibuat' });
    return;
  }

  res.json({ profile: result.rows[0] });
};

export const createOrUpdateProfile = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const { username, display_name, bio, avatar_url } = req.body;

  if (!username) {
    res.status(400).json({ error: 'Username wajib diisi' });
    return;
  }

  // Cek username sudah dipakai user lain
  const existing = await db.execute({
    sql: 'SELECT user_id FROM social_profiles WHERE username = ? AND user_id != ?',
    args: [username, userId]
  });

  if (existing.rows.length > 0) {
    res.status(409).json({ error: 'Username sudah dipakai' });
    return;
  }

  const check = await db.execute({
    sql: 'SELECT id FROM social_profiles WHERE user_id = ?',
    args: [userId]
  });

  if (check.rows.length === 0) {
    // Buat baru
    await db.execute({
      sql: `INSERT INTO social_profiles (id, user_id, username, display_name, bio, avatar_url)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [uuidv4(), userId, username, display_name || null, bio || null, avatar_url || null]
    });
  } else {
    // Update
    await db.execute({
      sql: `UPDATE social_profiles SET username = ?, display_name = ?, bio = ?, avatar_url = ?
            WHERE user_id = ?`,
      args: [username, display_name || null, bio || null, avatar_url || null, userId]
    });
  }

  const updated = await db.execute({
    sql: 'SELECT * FROM social_profiles WHERE user_id = ?',
    args: [userId]
  });

  res.json({ message: 'Profil berhasil disimpan!', profile: updated.rows[0] });
};

export const searchUsers = async (req: Request, res: Response): Promise<void> => {
  const { q } = req.query;

  if (!q) {
    res.status(400).json({ error: 'Query wajib diisi' });
    return;
  }

  const result = await db.execute({
    sql: `SELECT sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
            (SELECT COUNT(*) FROM follows WHERE following_id = sp.user_id) as followers_count
          FROM social_profiles sp
          WHERE sp.username LIKE ? OR sp.display_name LIKE ?
          LIMIT 20`,
    args: [`%${q}%`, `%${q}%`]
  });

  res.json({ users: result.rows });
};

// ─── FOLLOW ───────────────────────────────────────────────────────────────────

export const followUser = async (req: Request, res: Response): Promise<void> => {
  const followerId = (req as any).user.id;
  const { username } = req.params;

  const target = await db.execute({
    sql: 'SELECT user_id FROM social_profiles WHERE username = ?',
    args: [username]
  });

  if (target.rows.length === 0) {
    res.status(404).json({ error: 'User tidak ditemukan' });
    return;
  }

  const followingId = target.rows[0].user_id as string;

  if (followerId === followingId) {
    res.status(400).json({ error: 'Tidak bisa follow diri sendiri' });
    return;
  }

  try {
    await db.execute({
      sql: 'INSERT INTO follows (id, follower_id, following_id) VALUES (?, ?, ?)',
      args: [uuidv4(), followerId, followingId]
    });

    // Kirim notifikasi ke yang di-follow
    await db.execute({
      sql: `INSERT INTO social_notifications (id, user_id, actor_id, type)
            VALUES (?, ?, ?, 'follow')`,
      args: [uuidv4(), followingId, followerId]
    });

    await logActivity(followerId, 'social.follow', 'user', followingId);
    res.json({ message: 'Berhasil follow!' });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'Sudah follow user ini' });
    } else {
      throw e;
    }
  }
};

export const unfollowUser = async (req: Request, res: Response): Promise<void> => {
  const followerId = (req as any).user.id;
  const { username } = req.params;

  const target = await db.execute({
    sql: 'SELECT user_id FROM social_profiles WHERE username = ?',
    args: [username]
  });

  if (target.rows.length === 0) {
    res.status(404).json({ error: 'User tidak ditemukan' });
    return;
  }

  const followingId = target.rows[0].user_id as string;

  await db.execute({
    sql: 'DELETE FROM follows WHERE follower_id = ? AND following_id = ?',
    args: [followerId, followingId]
  });

  res.json({ message: 'Berhasil unfollow!' });
};

export const getFollowers = async (req: Request, res: Response): Promise<void> => {
  const { username } = req.params;

  const target = await db.execute({
    sql: 'SELECT user_id FROM social_profiles WHERE username = ?',
    args: [username]
  });

  if (target.rows.length === 0) {
    res.status(404).json({ error: 'User tidak ditemukan' });
    return;
  }

  const userId = target.rows[0].user_id as string;

  const result = await db.execute({
    sql: `SELECT sp.username, sp.display_name, sp.avatar_url, sp.is_bot
          FROM follows f
          JOIN social_profiles sp ON sp.user_id = f.follower_id
          WHERE f.following_id = ?
          ORDER BY f.created_at DESC`,
    args: [userId]
  });

  res.json({ followers: result.rows });
};

export const getFollowing = async (req: Request, res: Response): Promise<void> => {
  const { username } = req.params;

  const target = await db.execute({
    sql: 'SELECT user_id FROM social_profiles WHERE username = ?',
    args: [username]
  });

  if (target.rows.length === 0) {
    res.status(404).json({ error: 'User tidak ditemukan' });
    return;
  }

  const userId = target.rows[0].user_id as string;

  const result = await db.execute({
    sql: `SELECT sp.username, sp.display_name, sp.avatar_url, sp.is_bot
          FROM follows f
          JOIN social_profiles sp ON sp.user_id = f.following_id
          WHERE f.follower_id = ?
          ORDER BY f.created_at DESC`,
    args: [userId]
  });

  res.json({ following: result.rows });
};

// ─── FEED POSTS ───────────────────────────────────────────────────────────────

export const getFeed = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const { cursor, limit = 20 } = req.query;

  const cursorClause = cursor ? `AND fp.created_at < ?` : '';
  const args: any[] = [userId, userId];
  if (cursor) args.push(cursor);
  args.push(Number(limit));

  // Feed = post dari orang yang di-follow + post sendiri + post bot
  const result = await db.execute({
    sql: `SELECT fp.*,
            sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
            (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) as reactions_count,
            (SELECT COUNT(*) FROM comments WHERE post_id = fp.id) as comments_count,
            (SELECT type FROM reactions WHERE post_id = fp.id AND user_id = ?) as my_reaction
          FROM feed_posts fp
          JOIN social_profiles sp ON sp.user_id = fp.user_id
          WHERE (
            fp.user_id = ?
            OR fp.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
            OR (fp.is_bot_post = 1 AND fp.visibility = 'public')
          )
          AND fp.visibility != 'private'
          ${cursorClause}
          ORDER BY fp.created_at DESC
          LIMIT ?`,
    args: [userId, userId, userId, ...(cursor ? [cursor] : []), Number(limit)]
  });

  const posts = result.rows.map(parsePost);
  const nextCursor = posts.length === Number(limit)
    ? posts[posts.length - 1].created_at
    : null;

  res.json({ posts, next_cursor: nextCursor });
};

export const getPublicFeed = async (req: Request, res: Response): Promise<void> => {
  const { cursor, limit = 20 } = req.query;
  const args: any[] = [];
  if (cursor) args.push(cursor);
  args.push(Number(limit));

  const result = await db.execute({
    sql: `SELECT fp.*,
            sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
            (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) as reactions_count,
            (SELECT COUNT(*) FROM comments WHERE post_id = fp.id) as comments_count
          FROM feed_posts fp
          JOIN social_profiles sp ON sp.user_id = fp.user_id
          WHERE fp.visibility = 'public'
          ${cursor ? 'AND fp.created_at < ?' : ''}
          ORDER BY fp.created_at DESC
          LIMIT ?`,
    args
  });

  const posts = result.rows.map(parsePost);
  const nextCursor = posts.length === Number(limit)
    ? posts[posts.length - 1].created_at
    : null;

  res.json({ posts, next_cursor: nextCursor });
};

export const createPost = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const { content, media, visibility = 'public', entry_id } = req.body;

  if (!content && (!media || media.length === 0) && !entry_id) {
    res.status(400).json({ error: 'Konten tidak boleh kosong' });
    return;
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO feed_posts (id, user_id, entry_id, content, media, visibility, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, userId,
      entry_id || null,
      content || null,
      JSON.stringify(media || []),
      visibility,
      now
    ]
  });

  await logActivity(userId, 'social.post', 'feed_post', id);
  logger.info('Feed post created', { userId, postId: id });

  const post = await db.execute({ sql: 'SELECT * FROM feed_posts WHERE id = ?', args: [id] });
  res.status(201).json({ message: 'Post berhasil dibuat!', post: parsePost(post.rows[0]) });
};

export const deletePost = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const { id } = req.params;

  const result = await db.execute({
    sql: 'SELECT * FROM feed_posts WHERE id = ? AND user_id = ?',
    args: [id, userId]
  });

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Post tidak ditemukan' });
    return;
  }

  await db.execute({ sql: 'DELETE FROM comments WHERE post_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM reactions WHERE post_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM feed_posts WHERE id = ?', args: [id] });

  res.json({ message: 'Post berhasil dihapus!' });
};

// ─── REACTIONS ────────────────────────────────────────────────────────────────

export const reactToPost = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  const { type = 'like' } = req.body;

  const post = await db.execute({
    sql: 'SELECT * FROM feed_posts WHERE id = ?',
    args: [id]
  });

  if (post.rows.length === 0) {
    res.status(404).json({ error: 'Post tidak ditemukan' });
    return;
  }

  // Cek sudah react belum
  const existing = await db.execute({
    sql: 'SELECT * FROM reactions WHERE user_id = ? AND post_id = ?',
    args: [userId, id]
  });

  if (existing.rows.length > 0) {
    if ((existing.rows[0] as any).type === type) {
      // Sama → hapus (toggle off)
      await db.execute({
        sql: 'DELETE FROM reactions WHERE user_id = ? AND post_id = ?',
        args: [userId, id]
      });
      res.json({ message: 'Reaction dihapus', reacted: false });
    } else {
      // Beda → update
      await db.execute({
        sql: 'UPDATE reactions SET type = ? WHERE user_id = ? AND post_id = ?',
        args: [type, userId, id]
      });
      res.json({ message: 'Reaction diupdate', reacted: true, type });
    }
    return;
  }

  // Tambah reaction baru
  await db.execute({
    sql: 'INSERT INTO reactions (id, user_id, post_id, type) VALUES (?, ?, ?, ?)',
    args: [uuidv4(), userId, id, type]
  });

  // Notifikasi ke pemilik post
  const postOwnerId = post.rows[0].user_id as string;
  if (postOwnerId !== userId) {
    await db.execute({
      sql: `INSERT INTO social_notifications (id, user_id, actor_id, type, post_id)
            VALUES (?, ?, ?, 'reaction', ?)`,
      args: [uuidv4(), postOwnerId, userId, id]
    });
  }

  res.json({ message: 'Reaction ditambahkan!', reacted: true, type });
};

// ─── COMMENTS ────────────────────────────────────────────────────────────────

export const getComments = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  const result = await db.execute({
    sql: `SELECT c.*,
            sp.username, sp.display_name, sp.avatar_url, sp.is_bot,
            (SELECT COUNT(*) FROM comments WHERE parent_id = c.id) as replies_count
          FROM comments c
          JOIN social_profiles sp ON sp.user_id = c.user_id
          WHERE c.post_id = ? AND c.parent_id IS NULL
          ORDER BY c.created_at ASC`,
    args: [id]
  });

  res.json({ comments: result.rows });
};

export const getReplies = async (req: Request, res: Response): Promise<void> => {
  const { commentId } = req.params;

  const result = await db.execute({
    sql: `SELECT c.*, sp.username, sp.display_name, sp.avatar_url, sp.is_bot
          FROM comments c
          JOIN social_profiles sp ON sp.user_id = c.user_id
          WHERE c.parent_id = ?
          ORDER BY c.created_at ASC`,
    args: [commentId]
  });

  res.json({ replies: result.rows });
};

export const addComment = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  const { content, parent_id } = req.body;

  if (!content) {
    res.status(400).json({ error: 'Komentar tidak boleh kosong' });
    return;
  }

  const post = await db.execute({
    sql: 'SELECT * FROM feed_posts WHERE id = ?',
    args: [id]
  });

  if (post.rows.length === 0) {
    res.status(404).json({ error: 'Post tidak ditemukan' });
    return;
  }

  const commentId = uuidv4();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO comments (id, user_id, post_id, content, parent_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [commentId, userId, id, content, parent_id || null, now]
  });

  // Notifikasi ke pemilik post
  const postOwnerId = post.rows[0].user_id as string;
  if (postOwnerId !== userId) {
    await db.execute({
      sql: `INSERT INTO social_notifications (id, user_id, actor_id, type, post_id, comment_id)
            VALUES (?, ?, ?, 'comment', ?, ?)`,
      args: [uuidv4(), postOwnerId, userId, id, commentId]
    });
  }

  // Notifikasi ke pemilik komentar parent (reply)
  if (parent_id) {
    const parentComment = await db.execute({
      sql: 'SELECT user_id FROM comments WHERE id = ?',
      args: [parent_id]
    });
    const parentOwnerId = parentComment.rows[0]?.user_id as string;
    if (parentOwnerId && parentOwnerId !== userId) {
      await db.execute({
        sql: `INSERT INTO social_notifications (id, user_id, actor_id, type, post_id, comment_id)
              VALUES (?, ?, ?, 'reply', ?, ?)`,
        args: [uuidv4(), parentOwnerId, userId, id, commentId]
      });
    }
  }

  await logActivity(userId, 'social.comment', 'feed_post', id);

  const comment = await db.execute({
    sql: `SELECT c.*, sp.username, sp.display_name, sp.avatar_url
          FROM comments c
          JOIN social_profiles sp ON sp.user_id = c.user_id
          WHERE c.id = ?`,
    args: [commentId]
  });

  res.status(201).json({ message: 'Komentar ditambahkan!', comment: comment.rows[0] });
};

export const deleteComment = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const { commentId } = req.params;

  const result = await db.execute({
    sql: 'SELECT * FROM comments WHERE id = ? AND user_id = ?',
    args: [commentId, userId]
  });

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Komentar tidak ditemukan' });
    return;
  }

  // Hapus replies juga
  await db.execute({ sql: 'DELETE FROM comments WHERE parent_id = ?', args: [commentId] });
  await db.execute({ sql: 'DELETE FROM comments WHERE id = ?', args: [commentId] });

  res.json({ message: 'Komentar dihapus!' });
};

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

export const getNotifications = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;

  const result = await db.execute({
    sql: `SELECT sn.*,
            sp.username as actor_username,
            sp.display_name as actor_display_name,
            sp.avatar_url as actor_avatar
          FROM social_notifications sn
          JOIN social_profiles sp ON sp.user_id = sn.actor_id
          WHERE sn.user_id = ?
          ORDER BY sn.created_at DESC
          LIMIT 50`,
    args: [userId]
  });

  res.json({ notifications: result.rows });
};

export const markNotificationsRead = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;

  await db.execute({
    sql: 'UPDATE social_notifications SET is_read = 1 WHERE user_id = ?',
    args: [userId]
  });

  res.json({ message: 'Notifikasi ditandai sudah dibaca' });
};

// ─── SHARE ENTRY TO FEED ──────────────────────────────────────────────────────

export const shareEntryToFeed = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const { entry_id } = req.params;
  const { visibility = 'public' } = req.body;

  const entry = await db.execute({
    sql: 'SELECT * FROM entries WHERE id = ? AND user_id = ?',
    args: [entry_id, userId]
  });

  if (entry.rows.length === 0) {
    res.status(404).json({ error: 'Entry tidak ditemukan' });
    return;
  }

  const e = entry.rows[0] as any;
  const id = uuidv4();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO feed_posts (id, user_id, entry_id, content, media, visibility, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, userId, entry_id, e.content || e.title, e.media, visibility, now]
  });

  // Update visibility entry juga
  await db.execute({
    sql: 'UPDATE entries SET visibility = ? WHERE id = ?',
    args: [visibility, entry_id]
  });

  res.status(201).json({ message: 'Entry berhasil di-share ke feed!' });
};