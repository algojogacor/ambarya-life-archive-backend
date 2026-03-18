// backend/src/routes/confess.routes.ts

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getConfessFeed,
  getConfessDetail,
  submitConfess,
  toggleRelate,
  getConfessComments,
  addConfessComment,
  getMoodTags,
} from '../controllers/confess.controller';

const router = Router();

// ── Publik (butuh auth untuk has_related info) ────────────────────────────────
router.get('/moods',            getMoodTags);
router.get('/',                 authenticate, getConfessFeed);
router.get('/:id',              authenticate, getConfessDetail);
router.get('/:id/comments',     authenticate, getConfessComments);

// ── Auth required ─────────────────────────────────────────────────────────────
router.post('/',                authenticate, submitConfess);
router.post('/:id/relate',      authenticate, toggleRelate);
router.post('/:id/comments',    authenticate, addConfessComment);

export default router;