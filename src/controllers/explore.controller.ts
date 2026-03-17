// backend/src/controllers/explore.controller.ts

import { Request, Response } from 'express';
import db from '../db/database';

// Get public feed posts
export const getExploreFeed = async (req: Request, res: Response): Promise<void> => {
  const result = await db.execute({
    sql: `SELECT fp.*, sp.username, sp.avatar_url,
            (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) as reactions
          FROM feed_posts fp
          JOIN social_profiles sp ON fp.user_id = sp.user_id
          WHERE fp.visibility = 'public'
          ORDER BY fp.created_at DESC
          LIMIT 50`,
    args: []
  });
  res.json({ posts: result.rows });
};

// Get trending posts (by reactions)
export const getTrendingPosts = async (req: Request, res: Response): Promise<void> => {
  const result = await db.execute({
    sql: `SELECT fp.*, sp.username, sp.avatar_url,
            (SELECT COUNT(*) FROM reactions WHERE post_id = fp.id) as reactions
          FROM feed_posts fp
          JOIN social_profiles sp ON fp.user_id = sp.user_id
          WHERE fp.visibility = 'public'
          ORDER BY reactions DESC, fp.created_at DESC
          LIMIT 20`,
    args: []
  });
  res.json({ posts: result.rows });
};
