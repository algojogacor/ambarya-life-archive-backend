import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { getWeatherByCoords, getWeatherByCity } from '../services/weather.service';
import { searchPlaces, reverseGeocode, getStaticMapUrl } from '../services/maps.service';
import { searchTracks, getTrack } from '../services/spotify.service';
import { chat, getDailyReflection, askAboutMemory } from '../services/ai.service';
import db from '../db/database';

const router = Router();
router.use(authenticate);

// ─── WEATHER ─────────────────────────────────────────────
router.get('/weather', async (req: Request, res: Response) => {
  const { lat, lon, city } = req.query;
  try {
    const data = city
      ? await getWeatherByCity(String(city))
      : await getWeatherByCoords(Number(lat), Number(lon));
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Gagal mengambil data cuaca' });
  }
});

// ─── MAPS ─────────────────────────────────────────────────
router.get('/places/search', async (req: Request, res: Response) => {
  const { q, lat, lng } = req.query;
  if (!q) { res.status(400).json({ error: 'Query wajib diisi' }); return; }
  try {
    const places = await searchPlaces(String(q), Number(lat) || undefined, Number(lng) || undefined);
    res.json({ places });
  } catch {
    res.status(500).json({ error: 'Gagal mencari lokasi' });
  }
});

router.get('/places/reverse-geocode', async (req: Request, res: Response) => {
  const { lat, lng } = req.query;
  try {
    const address = await reverseGeocode(Number(lat), Number(lng));
    res.json({ address });
  } catch {
    res.status(500).json({ error: 'Gagal mendapatkan alamat' });
  }
});

router.get('/places/static-map', (req: Request, res: Response) => {
  const { lat, lng, zoom } = req.query;
  const url = getStaticMapUrl(Number(lat), Number(lng), Number(zoom) || 15);
  res.json({ url });
});

// ─── SPOTIFY ──────────────────────────────────────────────
router.get('/spotify/search', async (req: Request, res: Response) => {
  const { q, limit } = req.query;
  if (!q) { res.status(400).json({ error: 'Query wajib diisi' }); return; }
  try {
    const tracks = await searchTracks(String(q), Number(limit) || 10);
    res.json({ tracks });
  } catch {
    res.status(500).json({ error: 'Gagal mencari lagu' });
  }
});

router.get('/spotify/track/:id', async (req: Request, res: Response) => {
  try {
    const track = await getTrack(String(req.params.id));
    res.json({ track });
  } catch {
    res.status(500).json({ error: 'Gagal mengambil data lagu' });
  }
});

// ─── AI CHATBOT ───────────────────────────────────────────
router.post('/ai/chat', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { message, history } = req.body;

  if (!message) { res.status(400).json({ error: 'Message wajib diisi' }); return; }

  try {
    const recentEntries = db.prepare(`
      SELECT * FROM entries WHERE user_id = ? 
      ORDER BY created_at DESC LIMIT 10
    `).all(userId) as any[];

    const reply = await chat(message, history || [], recentEntries);
    res.json({ reply });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Gagal menghubungi AI' });
  }
});

router.get('/ai/daily-reflection', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;

  try {
    const today = new Date().toISOString().split('T')[0];
    const entries = db.prepare(`
      SELECT * FROM entries WHERE user_id = ? 
      AND strftime('%Y-%m-%d', created_at) = ?
      ORDER BY created_at ASC
    `).all(userId, today) as any[];

    if (entries.length === 0) {
      res.status(404).json({ error: 'Belum ada entry hari ini' });
      return;
    }

    const reflection = await getDailyReflection(entries);
    res.json({ reflection });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Gagal generate refleksi' });
  }
});

router.post('/ai/ask-memory', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { question } = req.body;

  if (!question) { res.status(400).json({ error: 'Question wajib diisi' }); return; }

  try {
    const entries = db.prepare(`
      SELECT * FROM entries WHERE user_id = ? 
      ORDER BY created_at DESC LIMIT 50
    `).all(userId) as any[];

    const answer = await askAboutMemory(question, entries);
    res.json({ answer });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Gagal menjawab pertanyaan' });
  }
});

export default router;