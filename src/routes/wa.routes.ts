import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import db from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

const router = Router();

// Generate link token untuk user
router.get('/wa/link-token', authenticate, async (req, res) => {
  const userId = (req as any).user.id;
  const token = jwt.sign({ userId, type: 'wa_link' }, process.env.JWT_SECRET!, { expiresIn: '10m' });
  res.json({ token });
});

// Bot link akun
router.post('/wa/link', async (req, res) => {
  const { token, waNumber } = req.body;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    if (decoded.type !== 'wa_link') {
      res.status(400).json({ error: 'Token tidak valid' });
      return;
    }

    const existing = await db.execute({
      sql: 'SELECT id FROM wa_sessions WHERE user_id = ?',
      args: [decoded.userId]
    });

    if (existing.rows.length > 0) {
      await db.execute({
        sql: 'UPDATE wa_sessions SET wa_number = ?, linked_at = datetime("now") WHERE user_id = ?',
        args: [waNumber, decoded.userId]
      });
    } else {
      await db.execute({
        sql: 'INSERT INTO wa_sessions (id, user_id, wa_number) VALUES (?, ?, ?)',
        args: [uuidv4(), decoded.userId, waNumber]
      });
    }

    res.json({ message: 'WA berhasil dihubungkan!' });
  } catch {
    res.status(400).json({ error: 'Token expired atau tidak valid' });
  }
});

// Bot get token by WA number
router.get('/wa/token/:waNumber', async (req, res) => {
  const { waNumber } = req.params;
  const session = await db.execute({
    sql: `SELECT rt.token, rt.expires_at FROM wa_sessions ws
          JOIN refresh_tokens rt ON rt.user_id = ws.user_id
          WHERE ws.wa_number = ? AND rt.revoked = 0
          ORDER BY rt.created_at DESC LIMIT 1`,
    args: [waNumber]
  });

  if (session.rows.length === 0) {
    res.status(404).json({ error: 'WA tidak terhubung' });
    return;
  }

  const row = session.rows[0] as any;

  // Check expired
  if (new Date(row.expires_at) < new Date()) {
    res.status(401).json({ error: 'Token expired' });
    return;
  }

  res.json({ token: row.token });
});

export default router;