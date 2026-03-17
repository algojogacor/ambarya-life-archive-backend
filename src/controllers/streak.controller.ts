// backend/src/controllers/streak.controller.ts

import { Request, Response } from 'express';
import { recordActivity, getUserStreak, checkAndResetStreaks } from '../services/streak.service';
import logger from '../services/logger.service';

const str = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return String(v[0]);
  if (v === null || v === undefined) return '';
  return String(v);
};

// Record activity - called when user creates entry or post
export const recordStreakActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = str((req as any).user.id);
    const streak = await recordActivity(userId);
    res.json({ streak });
  } catch (error) {
    logger.error('Failed to record streak activity', { error });
    res.status(500).json({ error: 'Gagal mencatat aktivitas streak' });
  }
};

// Get user's streak
export const getStreak = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = str((req as any).user.id);
    const streak = await getUserStreak(userId);
    res.json({ streak });
  } catch (error) {
    logger.error('Failed to get streak', { error });
    res.status(500).json({ error: 'Gagal mengambil data streak' });
  }
};

// Manual trigger for checking and resetting streaks (call via cron job)
export const triggerStreakReset = async (req: Request, res: Response): Promise<void> => {
  try {
    await checkAndResetStreaks();
    res.json({ message: 'Streak reset check completed' });
  } catch (error) {
    logger.error('Failed to reset streaks', { error });
    res.status(500).json({ error: 'Gagal melakukan reset streak' });
  }
};
