import db from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger.service';

type Action =
  | 'user.register' | 'user.login' | 'user.logout'
  | 'entry.create' | 'entry.update' | 'entry.delete'
  | 'media.upload' | 'media.upload_failed'
  | 'ai.chat' | 'ai.reflection'
  | 'export.pdf'
  | 'auth.refresh' | 'auth.revoke';

export const logActivity = (
  userId: string | null,
  action: Action,
  entity?: string,
  entityId?: string,
  meta?: Record<string, any>,
  ip?: string
) => {
  try {
    db.prepare(`
      INSERT INTO activity_logs (id, user_id, action, entity, entity_id, meta, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      userId,
      action,
      entity || null,
      entityId || null,
      JSON.stringify(meta || {}),
      ip || null
    );
  } catch (err) {
    logger.error('Failed to log activity', { action, userId, err });
  }
};

export const getActivityLogs = (userId: string, limit: number = 50) => {
  return db.prepare(`
    SELECT * FROM activity_logs 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(userId, limit);
};