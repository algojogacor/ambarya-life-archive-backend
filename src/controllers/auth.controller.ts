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

const generateTokens = async (userId: string, email: string) => {
  const accessToken = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });

  const refreshToken = uuidv4();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await db.execute({
    sql: `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`,
    args: [uuidv4(), userId, refreshToken, expiresAt.toISOString()]
  });

  return { accessToken, refreshToken };
};

export const register = async (req: Request, res: Response): Promise<void> => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    res.status(400).json({ error: 'Name, email, dan password wajib diisi' });
    return;
  }

  const existing = await db.execute({
    sql: 'SELECT id FROM users WHERE email = ?',
    args: [email]
  });

  if (existing.rows.length > 0) {
    res.status(409).json({ error: 'Email sudah terdaftar' });
    return;
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const id = uuidv4();

  await db.execute({
    sql: 'INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)',
    args: [id, name, email, hashedPassword]
  });

  const { accessToken, refreshToken } = await generateTokens(id, email);
  await logActivity(id, 'user.register', 'user', id, { email });
  logger.info('New user registered', { userId: id, email });

  res.status(201).json({
    message: 'Akun berhasil dibuat!',
    accessToken,
    refreshToken,
    user: { id, name, email }
  });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email dan password wajib diisi' });
    return;
  }

  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE email = ?',
    args: [email]
  });

  const user = result.rows[0] as any;

  if (!user || !bcrypt.compareSync(password, user.password as string)) {
    res.status(401).json({ error: 'Email atau password salah' });
    return;
  }

  const { accessToken, refreshToken } = await generateTokens(user.id as string, user.email as string);
  await logActivity(user.id as string, 'user.login', 'user', user.id as string, { email });
  logger.info('User logged in', { userId: user.id });

  res.json({
    message: 'Login berhasil!',
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email }
  });
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  const { refreshToken: token } = req.body;

  if (!token) {
    res.status(400).json({ error: 'Refresh token wajib diisi' });
    return;
  }

  const result = await db.execute({
    sql: `SELECT rt.*, u.email FROM refresh_tokens rt
          JOIN users u ON u.id = rt.user_id
          WHERE rt.token = ? AND rt.revoked = 0`,
    args: [token]
  });

  const stored = result.rows[0] as any;

  if (!stored) {
    res.status(401).json({ error: 'Refresh token tidak valid' });
    return;
  }

  if (new Date(stored.expires_at as string) < new Date()) {
    res.status(401).json({ error: 'Refresh token sudah expired' });
    return;
  }

  await db.execute({
    sql: 'UPDATE refresh_tokens SET revoked = 1 WHERE token = ?',
    args: [token]
  });

  const { accessToken, refreshToken: newRefreshToken } = await generateTokens(stored.user_id as string, stored.email as string);
  await logActivity(stored.user_id as string, 'auth.refresh');

  res.json({ accessToken, refreshToken: newRefreshToken });
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  const { refreshToken: token } = req.body;
  if (token) {
    await db.execute({
      sql: 'UPDATE refresh_tokens SET revoked = 1 WHERE token = ?',
      args: [token]
    });
  }
  const userId = (req as any).user?.id;
  if (userId) await logActivity(userId, 'user.logout');
  res.json({ message: 'Logout berhasil!' });
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user;
  const result = await db.execute({
    sql: 'SELECT id, name, email, created_at FROM users WHERE id = ?',
    args: [user.id]
  });
  res.json({ user: result.rows[0] });
};