import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Client Credentials Flow (untuk search, tidak perlu login user)
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

const getAppToken = async (): Promise<string> => {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await axios.post(
    'https://accounts.spotify.com/api/token',
    'grant_type=client_credentials',
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      }
    }
  );

  cachedToken = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
  return cachedToken!;
};

export const searchTracks = async (query: string, limit: number = 10) => {
  const token = await getAppToken();

  const res = await axios.get('https://api.spotify.com/v1/search', {
    headers: { Authorization: `Bearer ${token}` },
    params: { q: query, type: 'track', limit, market: 'ID' }
  });

  return res.data.tracks.items.map((t: any) => ({
    id: t.id,
    name: t.name,
    artist: t.artists.map((a: any) => a.name).join(', '),
    album: t.album.name,
    albumArt: t.album.images[0]?.url || null,
    previewUrl: t.preview_url,
    spotifyUrl: t.external_urls.spotify,
    durationMs: t.duration_ms,
  }));
};

export const getTrack = async (trackId: string) => {
  const token = await getAppToken();

  const res = await axios.get(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { market: 'ID' }
  });

  const t = res.data;
  return {
    id: t.id,
    name: t.name,
    artist: t.artists.map((a: any) => a.name).join(', '),
    album: t.album.name,
    albumArt: t.album.images[0]?.url || null,
    previewUrl: t.preview_url,
    spotifyUrl: t.external_urls.spotify,
    durationMs: t.duration_ms,
  };
};