// backend/src/controllers/profile.controller.ts

import { Request, Response } from 'express';
import db from '../db/database';
import { uploadToCloudinary } from '../services/cloudinary.service';

// Edit profile (display_name, bio, avatar_url)
export const editProfile = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  const { display_name, bio, avatar_url } = req.body;
  await db.execute({
    sql: `UPDATE social_profiles SET display_name = ?, bio = ?, avatar_url = ? WHERE user_id = ?`,
    args: [display_name, bio, avatar_url, userId]
  });
  res.json({ success: true });
};

// Upload avatar
export const uploadAvatar = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user.id;
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  const url = await uploadToCloudinary(req.file.buffer);
  await db.execute({
    sql: `UPDATE social_profiles SET avatar_url = ? WHERE user_id = ?`,
    args: [url, userId]
  });
  res.json({ url });
};
