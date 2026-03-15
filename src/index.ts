import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import './db/database';
import authRoutes from './routes/auth.routes';
import entryRoutes from './routes/entry.routes';
import extraRoutes from './routes/extra.routes';
import servicesRoutes from './routes/services.routes';
import { initCronJobs } from './services/cron.service';


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/api', extraRoutes);
app.use('/api', servicesRoutes);

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    app: "Ambarya's Life Archive",
    version: '1.0.0'
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/entries', entryRoutes);

app.listen(PORT, () => {
  console.log(`🗂️  Ambarya's Life Archive backend running on port ${PORT}`);
  initCronJobs();
});

export default app;