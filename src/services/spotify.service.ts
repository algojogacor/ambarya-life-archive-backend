import axios from 'axios';

// iTunes Search API - gratis, tanpa API key
const ITUNES_BASE = 'https://itunes.apple.com';

export const searchTracks = async (query: string, limit: number = 10) => {
  const res = await axios.get(`${ITUNES_BASE}/search`, {
    params: {
      term: query,
      media: 'music',
      entity: 'song',
      limit,
      country: 'ID',
      lang: 'id_ID',
    }
  });

  return res.data.results.map((t: any) => ({
    id: String(t.trackId),
    name: t.trackName,
    artist: t.artistName,
    album: t.collectionName,
    albumArt: t.artworkUrl100?.replace('100x100', '300x300') || null,
    previewUrl: t.previewUrl || null,
    itunesUrl: t.trackViewUrl || null,
    durationMs: t.trackTimeMillis || 0,
    genre: t.primaryGenreName || null,
    releaseDate: t.releaseDate || null,
  }));
};

export const getTrack = async (trackId: string) => {
  const res = await axios.get(`${ITUNES_BASE}/lookup`, {
    params: { id: trackId }
  });

  if (!res.data.results || res.data.results.length === 0) {
    throw new Error('Track tidak ditemukan');
  }

  const t = res.data.results[0];
  return {
    id: String(t.trackId),
    name: t.trackName,
    artist: t.artistName,
    album: t.collectionName,
    albumArt: t.artworkUrl100?.replace('100x100', '300x300') || null,
    previewUrl: t.previewUrl || null,
    itunesUrl: t.trackViewUrl || null,
    durationMs: t.trackTimeMillis || 0,
    genre: t.primaryGenreName || null,
    releaseDate: t.releaseDate || null,
  };
};