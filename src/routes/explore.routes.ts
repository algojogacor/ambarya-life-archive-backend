// backend/src/routes/explore.routes.ts

import { Router } from 'express';
import { getExploreFeed, getTrendingPosts } from '../controllers/explore.controller';

const router = Router();

router.get('/feed', getExploreFeed);
router.get('/trending', getTrendingPosts);

export default router;
