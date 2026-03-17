// backend/src/routes/social.routes.ts

import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.middleware';
import {
  getProfile, getMyProfile, createOrUpdateProfile, searchUsers,
  followUser, unfollowUser, getFollowers, getFollowing,
  getFeed, getPublicFeed, createPost, deletePost, uploadPostMedia,
  reactToPost, getComments, getReplies, addComment, deleteComment,
  getNotifications, markNotificationsRead, shareEntryToFeed,
} from '../controllers/social.controller';
import { getExploreFeed, getTrendingPosts } from '../controllers/explore.controller';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── Profile ───────────────────────────────────────────────
router.get('/profile/me',                    authenticate,         getMyProfile);
router.post('/profile',                      authenticate,         createOrUpdateProfile);
router.get('/profile/:username',             authenticate,         getProfile);
router.get('/profile/:username/followers',   authenticate,         getFollowers);
router.get('/profile/:username/following',   authenticate,         getFollowing);

// ── Search ────────────────────────────────────────────────
// GET /social/users/search?q=keyword
router.get('/users/search',                  authenticate,         searchUsers);

// ── Explore ───────────────────────────────────────────────
// GET /social/explore              → all public posts (newest)
// GET /social/explore/trending     → public posts by reaction count (7d default)
router.get('/explore',                       authenticate, getExploreFeed);
router.get('/explore/trending',              authenticate, getTrendingPosts);

// ── Follow ────────────────────────────────────────────────
router.post('/follow/:username',             authenticate,         followUser);
router.delete('/follow/:username',           authenticate,         unfollowUser);

// ── Feed ──────────────────────────────────────────────────
router.get('/feed',                          authenticate,         getFeed);
router.get('/feed/public',                   getPublicFeed);
router.post('/feed',                         authenticate,         createPost);
router.delete('/feed/:id',                   authenticate,         deletePost);
router.post('/feed/:id/media',               authenticate,         upload.array('files', 10), uploadPostMedia);

// ── Share entry ke feed ───────────────────────────────────
router.post('/feed/share/:entry_id',         authenticate,         shareEntryToFeed);

// ── Reactions ─────────────────────────────────────────────
router.post('/feed/:id/react',               authenticate,         reactToPost);

// ── Comments ──────────────────────────────────────────────
router.get('/feed/:id/comments',             authenticate,         getComments);
router.post('/feed/:id/comments',            authenticate,         addComment);
router.delete('/comments/:commentId',        authenticate,         deleteComment);
router.get('/comments/:commentId/replies',   authenticate,         getReplies);

// ── Notifications ─────────────────────────────────────────
router.get('/notifications',                 authenticate,         getNotifications);
router.post('/notifications/read',           authenticate,         markNotificationsRead);

export default router;