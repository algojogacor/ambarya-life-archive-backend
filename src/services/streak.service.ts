// backend/src/services/streak.service.ts

import db from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import type { InValue } from '@libsql/client';

const a = (v: unknown): InValue => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return String(v);
};

// Get or create streak record for user
export const getOrCreateStreak = async (userId: string) => {
  const result = await db.execute({
    sql: 'SELECT * FROM streaks WHERE user_id = ?',
    args: [a(userId)]
  });

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  // Create new streak record
  const id = uuidv4();
  await db.execute({
    sql: `INSERT INTO streaks (id, user_id, current_streak, longest_streak, last_activity_date, created_at)
          VALUES (?, ?, 0, 0, NULL, datetime('now'))`,
    args: [a(id), a(userId)]
  });

  return {
    id,
    user_id: userId,
    current_streak: 0,
    longest_streak: 0,
    last_activity_date: null,
    created_at: new Date().toISOString()
  };
};

// Record activity for user (checks for streak continuation)
export const recordActivity = async (userId: string) => {
  const streak = await getOrCreateStreak(userId);
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

  // Check if already recorded today
  if (streak.last_activity_date === today) {
    return streak; // Already recorded today, no change
  }

  const lastDate = streak.last_activity_date ? new Date(streak.last_activity_date) : null;
  const todayDate = new Date(today);
  
  let newStreak = streak.current_streak;
  let newLongest = streak.longest_streak;

  if (lastDate) {
    const daysDiff = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysDiff === 1) {
      // Consecutive day - increment streak
      newStreak = streak.current_streak + 1;
    } else if (daysDiff > 1) {
      // Gap detected - reset streak
      newStreak = 1;
    }
    // If daysDiff === 0, it's the same day (shouldn't happen but handle gracefully)
  } else {
    // First activity
    newStreak = 1;
  }

  // Update longest streak if new streak is greater
  if (newStreak > streak.longest_streak) {
    newLongest = newStreak;
  }

  // Update streak record
  await db.execute({
    sql: `UPDATE streaks
          SET current_streak = ?, longest_streak = ?, last_activity_date = ?
          WHERE user_id = ?`,
    args: [a(newStreak), a(newLongest), a(today), a(userId)]
  });

  return {
    ...streak,
    current_streak: newStreak,
    longest_streak: newLongest,
    last_activity_date: today
  };
};

// Auto-reset streak if user skipped a day
export const checkAndResetStreaks = async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const result = await db.execute({
    sql: 'SELECT * FROM streaks WHERE last_activity_date < ? AND current_streak > 0',
    args: [a(yesterdayStr)]
  });

  // Reset streaks for users who didn't activity yesterday
  for (const row of result.rows) {
    // Only reset if last activity was more than 1 day ago
    const lastDate = new Date(String(row.last_activity_date));
    const daysDiff = Math.floor((new Date().getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysDiff > 1) {
      await db.execute({
        sql: 'UPDATE streaks SET current_streak = 0 WHERE id = ?',
        args: [a(row.id)]
      });
    }
  }
};

// Get user streak info
export const getUserStreak = async (userId: string) => {
  const result = await db.execute({
    sql: 'SELECT * FROM streaks WHERE user_id = ?',
    args: [a(userId)]
  });

  if (result.rows.length === 0) {
    return await getOrCreateStreak(userId);
  }

  return result.rows[0];
};
