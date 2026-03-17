// backend/src/routes/streak.routes.ts

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { getStreak, recordStreakActivity, triggerStreakReset } from '../controllers/streak.controller';

const router = Router();

router.get('/', authenticate, getStreak);
router.post('/activity', authenticate, recordStreakActivity);
router.post('/reset', triggerStreakReset); // For cron/manual

export default router;
