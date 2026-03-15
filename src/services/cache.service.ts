import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';
import logger from './logger.service';
dotenv.config();

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const DEFAULT_TTL = 60 * 60; // 1 jam

export const cacheGet = async <T>(key: string): Promise<T | null> => {
  try {
    const data = await redis.get<T>(key);
    return data;
  } catch (err) {
    logger.error('Cache GET error', { key, err });
    return null;
  }
};

export const cacheSet = async (key: string, value: any, ttl: number = DEFAULT_TTL): Promise<void> => {
  try {
    await redis.set(key, value, { ex: ttl });
  } catch (err) {
    logger.error('Cache SET error', { key, err });
  }
};

export const cacheDel = async (...keys: string[]): Promise<void> => {
  try {
    await redis.del(...keys);
  } catch (err) {
    logger.error('Cache DEL error', { keys, err });
  }
};

export const cacheDelPattern = async (pattern: string): Promise<void> => {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  } catch (err) {
    logger.error('Cache DEL pattern error', { pattern, err });
  }
};

export default redis;