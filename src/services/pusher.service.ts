// backend/src/services/pusher.service.ts

import Pusher from 'pusher';
import logger from './logger.service';

// ─── PUSHER CLIENT ────────────────────────────────────────────────────────────

const pusher = new Pusher({
  appId:   process.env.PUSHER_APP_ID!,
  key:     process.env.PUSHER_KEY!,
  secret:  process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER || 'ap1',
  useTLS:  true,
});

// ─── CHANNEL NAMES ────────────────────────────────────────────────────────────

export const confessChannel = (confessId: string) => `confess-${confessId}`;

// ─── EVENTS ───────────────────────────────────────────────────────────────────

export const PUSHER_EVENTS = {
  NEW_COMMENT:    'new-comment',
  RELATE_UPDATED: 'relate-updated',
} as const;

// ─── TRIGGER HELPERS ─────────────────────────────────────────────────────────

/**
 * Trigger komentar baru (dari user atau dari Bisikan Jiwa)
 * ke semua client yang subscribe ke channel confess ini
 */
export const triggerNewComment = async (
  confessId: string,
  comment: {
    id:           string;
    content:      string;
    is_ai_reply:  boolean;
    created_at:   string;
    commenter: {
      username:     string;
      display_name: string;
      avatar_url:   string | null;
      is_ai:        boolean;
    };
  }
): Promise<void> => {
  try {
    await pusher.trigger(
      confessChannel(confessId),
      PUSHER_EVENTS.NEW_COMMENT,
      comment
    );
    logger.info('Pusher: new-comment triggered', { confessId, isAi: comment.is_ai_reply });
  } catch (err) {
    // Non-fatal — real-time gagal tidak boleh block flow utama
    logger.warn('Pusher: trigger new-comment failed', { confessId, err });
  }
};

/**
 * Trigger update relate count
 */
export const triggerRelateUpdated = async (
  confessId: string,
  data: { relate_count: number; }
): Promise<void> => {
  try {
    await pusher.trigger(
      confessChannel(confessId),
      PUSHER_EVENTS.RELATE_UPDATED,
      data
    );
    logger.info('Pusher: relate-updated triggered', { confessId });
  } catch (err) {
    logger.warn('Pusher: trigger relate-updated failed', { confessId, err });
  }
};

export default pusher;