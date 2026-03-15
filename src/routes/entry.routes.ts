import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.middleware';
import { getEntries, getEntry, createEntry, uploadMedia, 
  updateEntry, deleteEntry, getOnThisDay, getRandomMemory,
  setPin, verifyPin, getVersions, rollbackVersion } from '../controllers/entry.controller';


const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use(authenticate);

router.get('/', getEntries);
router.get('/on-this-day', getOnThisDay);
router.get('/random', getRandomMemory);
router.get('/:id', getEntry);
router.post('/', createEntry);
router.post('/:id/media', upload.array('files', 10), uploadMedia);
router.put('/:id', updateEntry);
router.delete('/:id', deleteEntry);
router.post('/:id/set-pin', setPin);
router.post('/:id/verify-pin', verifyPin);
router.get('/:id/versions', getVersions);
router.post('/:id/rollback/:versionId', rollbackVersion);

export default router;