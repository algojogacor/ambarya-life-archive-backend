import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { logActivity } from '../services/activity.service';
import logger from '../services/logger.service';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

const generateTokens = (userId: string, email: string) => {
  const accessToken = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });

  const refreshToken = uuidv4();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(uuidv4(), userId, refreshToken, expiresAt.toISOString());

  return { accessToken, refreshToken };
};

export const register = (req: Request, res: Response): void => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    res.status(400).json({ error: 'Name, email, dan password wajib diisi' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'Email sudah terdaftar' });
    return;
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const id = uuidv4();

  db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)')
    .run(id, name, email, hashedPassword);

  const { accessToken, refreshToken } = generateTokens(id, email);
  logActivity(id, 'user.register', 'user', id, { email });
  logger.info('New user registered', { userId: id, email });

  res.status(201).json({
    message: 'Akun berhasil dibuat!',
    accessToken,
    refreshToken,
    user: { id, name, email }
  });
};

export const login = (req: Request, res: Response): void => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email dan password wajib diisi' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
  if (!user || !bcrypt.compareSync(password, user.password)) {
    res.status(401).json({ error: 'Email atau password salah' });
    return;
  }

  const { accessToken, refreshToken } = generateTokens(user.id, user.email);
  logActivity(user.id, 'user.login', 'user', user.id, { email });
  logger.info('User logged in', { userId: user.id });

  res.json({
    message: 'Login berhasil!',
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email }
  });
};

export const refreshToken = (req: Request, res: Response): void => {
  const { refreshToken: token } = req.body;

  if (!token) {
    res.status(400).json({ error: 'Refresh token wajib diisi' });
    return;
  }

  const stored = db.prepare(`
    SELECT rt.*, u.email FROM refresh_tokens rt
    JOIN users u ON u.id = rt.user_id
    WHERE rt.token = ? AND rt.revoked = 0
  `).get(token) as any;

  if (!stored) {
    res.status(401).json({ error: 'Refresh token tidak valid' });
    return;
  }

  if (new Date(stored.expires_at) < new Date()) {
    res.status(401).json({ error: 'Refresh token sudah expired' });
    return;
  }

  // Rotate: revoke old, buat baru
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?').run(token);

  const { accessToken, refreshToken: newRefreshToken } = generateTokens(stored.user_id, stored.email);
  logActivity(stored.user_id, 'auth.refresh');

  res.json({ accessToken, refreshToken: newRefreshToken });
};

export const logout = (req: Request, res: Response): void => {
  const { refreshToken: token } = req.body;
  if (token) {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?').run(token);
  }
  const userId = (req as any).user?.id;
  if (userId) logActivity(userId, 'user.logout');
  res.json({ message: 'Logout berhasil!' });
};

export const getMe = (req: Request, res: Response): void => {
  const user = (req as any).user;
  const data = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(user.id) as any;
  res.json({ user: data });
};