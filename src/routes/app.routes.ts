import { Router } from 'express';
import { getAppVersion } from '../controllers/app.controller';

const router = Router();
router.get('/version', getAppVersion);
export default router;