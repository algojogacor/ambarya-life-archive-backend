// backend/src/controllers/profile.controller.ts

import { Request, Response } from 'express';
import type { InValue } from '@libsql/client';
import db from '../db/database';
import { uploadToCloudinary, deleteFromCloudinary } from '../services/cloudinary.service';
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

// ─── UPDATE PROFILE (display_name, bio) ──────────────────────────────────────

/**
 * PUT /social/profile
 * Body: { display_name?, bio? }
 * Upsert: buat profil kalau belum ada, update kalau sudah ada.
 */
export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  const { display_name, bio } = req.body;

  const existing = await db.execute({
    sql: 'SELECT id FROM social_profiles WHERE user_id = ?',
    args: [a(userId)],
  });

  if (existing.rows.length === 0) {
    // ✅ Profil belum ada → buat dulu dengan data yang ada
    await db.execute({
      sql: `INSERT INTO social_profiles (user_id, display_name, bio)
            VALUES (?, ?, ?)`,
      args: [
        a(userId),
        a(display_name?.trim() || null),
        a(bio?.trim()          || null),
      ],
    });
  } else {
    // ✅ Profil sudah ada → update
    await db.execute({
      sql: `UPDATE social_profiles
            SET display_name = ?,
                bio          = ?
            WHERE user_id = ?`,
      args: [
        a(display_name?.trim() || null),
        a(bio?.trim()          || null),
        a(userId),
      ],
    });
  }

  await logActivity(userId, 'profile.update', 'social_profile', userId);

  const updated = await db.execute({
    sql: `SELECT sp.*, u.name, u.email,
            (SELECT COUNT(*) FROM follows WHERE following_id = sp.user_id) as followers_count,
            (SELECT COUNT(*) FROM follows WHERE follower_id  = sp.user_id) as following_count,
            (SELECT COUNT(*) FROM feed_posts WHERE user_id  = sp.user_id) as posts_count
          FROM social_profiles sp
          JOIN users u ON u.id = sp.user_id
          WHERE sp.user_id = ?`,
    args: [a(userId)],
  });

  res.json({ message: 'Profil berhasil diperbarui!', profile: updated.rows[0] });
};

// ─── UPLOAD AVATAR ────────────────────────────────────────────────────────────

/**
 * POST /social/profile/avatar
 * Multipart: field "avatar" (single file, image only)
 */
export const uploadAvatar = async (req: Request, res: Response): Promise<void> => {
  const userId = str((req as any).user.id);
  const file = req.file as Express.Multer.File | undefined;

  if (!file) {
    res.status(400).json({ error: 'File avatar tidak ditemukan' });
    return;
  }

  if (!file.mimetype.startsWith('image/')) {
    res.status(400).json({ error: 'Hanya file gambar yang diperbolehkan' });
    return;
  }

  // Ambil avatar lama untuk dihapus dari Cloudinary setelah upload baru berhasil
  const existing = await db.execute({
    sql: 'SELECT avatar_url FROM social_profiles WHERE user_id = ?',
    args: [a(userId)],
  });

  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Profil belum dibuat. Setup profil terlebih dahulu.' });
    return;
  }

  const oldAvatarUrl = str(existing.rows[0].avatar_url);

  try {
    // Compress → upload ke Cloudinary folder "avatars"
    const { buffer } = await compressImage(file.buffer, file.mimetype);
    const { fileId, webViewLink } = await uploadToCloudinary(buffer, 'avatars');

    // Update DB
    await db.execute({
      sql: 'UPDATE social_profiles SET avatar_url = ? WHERE user_id = ?',
      args: [a(webViewLink), a(userId)],
    });

    await logActivity(userId, 'profile.avatar_update', 'social_profile', userId);
    logger.info('Avatar updated', { userId, fileId });

    // Hapus avatar lama dari Cloudinary (best-effort, tidak throw kalau gagal)
    if (oldAvatarUrl) {
      const oldPublicId = _extractPublicId(oldAvatarUrl);
      if (oldPublicId) {
        deleteFromCloudinary(oldPublicId).catch((err) =>
          logger.warn('Failed to delete old avatar', { oldPublicId, err })
        );
      }
    }

    res.json({ message: 'Avatar berhasil diperbarui!', avatar_url: webViewLink });
  } catch (err) {
    logger.error('Avatar upload failed', { userId, err });
    res.status(500).json({ error: 'Gagal upload avatar, coba lagi' });
  }
};

// ─── HELPER ───────────────────────────────────────────────────────────────────

/**
 * Ekstrak Cloudinary public_id dari secure_url.
 * Contoh: https://res.cloudinary.com/demo/image/upload/v123/avatars/abc.jpg
 *       → avatars/abc
 */
const _extractPublicId = (url: string): string | null => {
  try {
    const parts = url.split('/upload/');
    if (parts.length < 2) return null;
    // Hapus version prefix (v1234567/) jika ada
    const withoutVersion = parts[1].replace(/^v\d+\//, '');
    // Hapus ekstensi
    return withoutVersion.replace(/\.[^/.]+$/, '');
  } catch {
    return null;
  }
};