import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getProfile, getMyProfile, createOrUpdateProfile, searchUsers,
  followUser, unfollowUser, getFollowers, getFollowing,
  getFeed, getPublicFeed, createPost, deletePost,
  reactToPost, getComments, getReplies, addComment, deleteComment,
  getNotifications, markNotificationsRead, shareEntryToFeed,
} from '../controllers/social.controller';

const router = Router();

// ── Profile ──────────────────────────────────────────────
router.get('/profile/me', authenticate, getMyProfile);
router.post('/profile', authenticate, createOrUpdateProfile);
router.get('/profile/:username', authenticate, getProfile);
router.get('/profile/:username/followers', authenticate, getFollowers);
router.get('/profile/:username/following', authenticate, getFollowing);
router.get('/users/search', authenticate, searchUsers);

// ── Follow ───────────────────────────────────────────────
router.post('/follow/:username', authenticate, followUser);
router.delete('/follow/:username', authenticate, unfollowUser);

// ── Feed ─────────────────────────────────────────────────
router.get('/feed', authenticate, getFeed);
router.get('/feed/public', getPublicFeed); // tidak perlu login
router.post('/feed', authenticate, createPost);
router.delete('/feed/:id', authenticate, deletePost);

// ── Share entry ke feed ───────────────────────────────────
router.post('/feed/share/:entry_id', authenticate, shareEntryToFeed);

// ── Reactions ─────────────────────────────────────────────
router.post('/feed/:id/react', authenticate, reactToPost);

// ── Comments ──────────────────────────────────────────────
router.get('/feed/:id/comments', authenticate, getComments);
router.post('/feed/:id/comments', authenticate, addComment);
router.delete('/comments/:commentId', authenticate, deleteComment);
router.get('/comments/:commentId/replies', authenticate, getReplies);

// ── Notifications ─────────────────────────────────────────
router.get('/notifications', authenticate, getNotifications);
router.post('/notifications/read', authenticate, markNotificationsRead);

export default router;