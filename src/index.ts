import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDB } from './db/database';
import authRoutes from './routes/auth.routes';
import entryRoutes from './routes/entry.routes';
import extraRoutes from './routes/extra.routes';
import waRoutes from './routes/wa.routes';
import socialRoutes from './routes/social.routes';
import servicesRoutes from './routes/services.routes';
import { initCronJobs } from './services/cron.service';
import confessRoutes from './routes/confess.routes';
import { runMigrations } from './db/migrate';
import logger from './services/logger.service';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    app: "Ambarya's Life Archive",
    version: '1.0.0'
  });
});

// ─── APP VERSION CHECK ───────────────────────────────────────────────────────
// Update 'latest' dan 'downloadUrl' setiap kali ada versi baru
app.get('/api/app/version', (req, res) => {
  res.json({
    latest: process.env.APP_VERSION || '1.0.0',
    download_url: process.env.APP_DOWNLOAD_URL || '',
    force: false,        // true = user WAJIB update, tidak bisa skip
    changelog: process.env.APP_CHANGELOG || 'Bug fixes and improvements',
  });
});
// ─────────────────────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/entries', entryRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/confess', confessRoutes);
app.use('/api', extraRoutes);
app.use('/api', waRoutes);
app.use('/api', servicesRoutes);

const start = async () => {
  try {
    await initDB();
    await runMigrations();
    app.listen(PORT, () => {
      logger.info(`🗂️  Ambarya's Life Archive backend running on port ${PORT}`);
      initCronJobs();
    });
  } catch (err) {
    logger.error('Failed to start server', { err });
    process.exit(1);
  }
};

start();

export default app;