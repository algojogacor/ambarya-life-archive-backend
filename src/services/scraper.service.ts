// backend/src/services/scraper.service.ts

import axios from 'axios';
import logger from './logger.service';

export interface ScrapedContent {
  content: string;
  sourceUrl?: string;
  sourceName?: string;
  imageUrl?: string;
}

// ─── GROQ CLEAN ───────────────────────────────────────────────────────────────

const GROQ_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
].filter(Boolean) as string[];

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
let keyIndex = 0;

const cleanWithGroq = async (rawTitle: string, rawDesc: string, topic: string): Promise<string> => {
  if (GROQ_KEYS.length === 0) return `${rawTitle}\n\n${rawDesc}`.trim();

  const key = GROQ_KEYS[keyIndex % GROQ_KEYS.length];
  keyIndex++;

  const topicHints: Record<string, string> = {
    news: 'berita terkini Indonesia',
    tech: 'teknologi dan inovasi',
    islamic: 'dakwah dan hikmah Islam',
    life: 'gaya hidup dan psikologi',
    entertainment: 'hiburan dan lifestyle',
    quotes: 'motivasi dan inspirasi',
    facts: 'fakta unik dan menarik',
  };

  const hint = topicHints[topic] || 'konten informatif';

  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: `Kamu adalah editor konten sosial media ${hint}. 
Tugasmu: ubah judul dan deskripsi artikel RSS menjadi caption sosial media yang natural, singkat, dan engaging dalam Bahasa Indonesia.
Format: tulis caption 2-4 kalimat saja. Jangan ada HTML tag, jangan ada URL, jangan terlalu formal.
Kalau konten dalam bahasa Inggris, terjemahkan ke Bahasa Indonesia yang natural.
HANYA output caption, tidak ada penjelasan lain.`
          },
          {
            role: 'user',
            content: `Judul: ${rawTitle}\nDeskripsi: ${rawDesc.substring(0, 400)}\n\nBuat caption:`
          }
        ],
        max_tokens: 200,
        temperature: 0.75,
      },
      {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    return res.data.choices[0].message.content.trim();
  } catch (err: any) {
    logger.warn('Groq clean failed, using raw', { err: err.message });
    // Fallback: bersihkan manual
    return `${rawTitle}\n\n${rawDesc.replace(/<[^>]+>/g, '').trim().substring(0, 280)}`.trim();
  }
};

// ─── GROQ GENERATE (untuk konten non-RSS) ─────────────────────────────────────

export const generateWithGroq = async (topic: string): Promise<ScrapedContent | null> => {
  if (GROQ_KEYS.length === 0) return null;

  const key = GROQ_KEYS[keyIndex % GROQ_KEYS.length];
  keyIndex++;

  const prompts: Record<string, string> = {
    quotes: 'Buat 1 quote motivasi yang original dan inspiratif dalam Bahasa Indonesia. Tambahkan nama tokoh fiktif atau nyata sebagai atribusi. Format: "Quote" — Nama Tokoh',
    motivational: 'Buat 1 pesan motivasi singkat dan powerful dalam Bahasa Indonesia. 2-3 kalimat saja.',
    islamic: 'Bagikan 1 ayat Al-Quran atau hadits yang relevan dengan kehidupan sehari-hari, beserta maknanya dalam 2-3 kalimat. Gunakan Bahasa Indonesia.',
    facts: 'Bagikan 1 fakta unik dan menarik yang jarang diketahui orang. Mulai dengan "Tahukah kamu?" dalam Bahasa Indonesia.',
    life: 'Bagikan 1 tips kehidupan atau psikologi yang praktis dan bermanfaat. 2-3 kalimat dalam Bahasa Indonesia.',
  };

  const prompt = prompts[topic] || prompts.motivational;

  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: MODEL,
        messages: [
          { role: 'system', content: 'Kamu adalah kreator konten sosial media. Buat konten singkat, engaging, dan berkualitas. HANYA output kontennya saja, tanpa penjelasan tambahan.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 200,
        temperature: 0.9,
      },
      {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    return {
      content: res.data.choices[0].message.content.trim(),
      sourceName: 'AI Generated',
    };
  } catch (err: any) {
    logger.warn('Groq generate failed', { err: err.message });
    return null;
  }
};

// ─── RSS FEEDS ────────────────────────────────────────────────────────────────

const RSS_FEEDS: Record<string, { url: string; name: string }[]> = {
  news: [
    { url: 'https://rss.detik.com/index.php/detikcom', name: 'Detik.com' },
    { url: 'https://www.kompas.com/rss/headlines.xml', name: 'Kompas.com' },
    { url: 'https://www.cnnindonesia.com/rss', name: 'CNN Indonesia' },
  ],
  tech: [
    { url: 'https://www.cnnindonesia.com/teknologi/rss', name: 'CNN Tech ID' },
    { url: 'https://feeds.feedburner.com/TechCrunch', name: 'TechCrunch' },
  ],
  islamic: [
    { url: 'https://www.islampos.com/feed/', name: 'IslamPos' },
  ],
  life: [
    { url: 'https://www.cnnindonesia.com/gaya-hidup/rss', name: 'CNN Gaya Hidup' },
  ],
  entertainment: [
    { url: 'https://www.cnnindonesia.com/hiburan/rss', name: 'CNN Hiburan' },
  ],
};

// ─── EXTRACT IMAGE ────────────────────────────────────────────────────────────

const extractImage = (itemContent: string): string | undefined => {
  const patterns = [
    /<enclosure[^>]+url="([^"]+\.(jpg|jpeg|png|webp))"/i,
    /<media:content[^>]+url="([^"]+\.(jpg|jpeg|png|webp))"/i,
    /<media:thumbnail[^>]+url="([^"]+)"/i,
    /<img[^>]+src="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i,
    /https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/i,
  ];
  for (const p of patterns) {
    const m = itemContent.match(p);
    if (m?.[1]) return m[1];
  }
  return undefined;
};

// ─── PARSE RSS ────────────────────────────────────────────────────────────────

const stripHtml = (html: string): string =>
  html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/g, ' ').replace(/\s{2,}/g, ' ').trim();

const parseRSS = (xml: string) => {
  const items: { title: string; link: string; description: string; imageUrl?: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const c = match[1];
    const title = stripHtml(c.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
    const link = c.match(/<link>(.*?)<\/link>/)?.[1]?.trim() || '';
    const description = stripHtml(c.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '').substring(0, 400);
    const imageUrl = extractImage(c);
    if (title) items.push({ title, link, description, imageUrl });
  }
  return items.slice(0, 8);
};

// ─── FETCH FROM RSS ───────────────────────────────────────────────────────────

export const fetchFromRSS = async (topic: string): Promise<ScrapedContent[]> => {
  const feeds = RSS_FEEDS[topic] || RSS_FEEDS.news;
  const results: ScrapedContent[] = [];

  for (const feed of feeds) {
    try {
      const response = await axios.get(feed.url, {
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AmbaryaBot/1.0)' },
      });

      const items = parseRSS(response.data as string);
      for (const item of items.slice(0, 2)) {
        // ✅ Groq bersihkan dan buat caption natural
        const caption = await cleanWithGroq(item.title, item.description, topic);

        results.push({
          content: caption,
          sourceUrl: item.link,
          sourceName: feed.name,
          imageUrl: item.imageUrl,
        });

        if (results.length >= 3) break;
      }
    } catch (err) {
      logger.warn('RSS fetch failed', { feed: feed.name });
    }

    if (results.length >= 3) break;
  }

  return results;
};

// ─── MAIN FETCH BY TOPIC ──────────────────────────────────────────────────────

export const fetchContentByTopic = async (topic: string): Promise<ScrapedContent | null> => {
  try {
    switch (topic) {
      case 'news':
      case 'tech':
      case 'life':
      case 'entertainment': {
        // Coba RSS dulu, fallback ke Groq generate
        const items = await fetchFromRSS(topic);
        if (items.length > 0) return items[Math.floor(Math.random() * items.length)];
        return generateWithGroq(topic);
      }
      case 'quotes':
      case 'motivational':
      case 'facts':
      case 'life':
        return generateWithGroq(topic);
      case 'islamic':
      case 'dakwah': {
        // Coba RSS dulu, fallback ke Groq
        const items = await fetchFromRSS('islamic');
        if (items.length > 0) return items[Math.floor(Math.random() * items.length)];
        return generateWithGroq('islamic');
      }
      default: {
        const t = ['quotes', 'news', 'islamic', 'facts', 'life'][Math.floor(Math.random() * 5)];
        return fetchContentByTopic(t);
      }
    }
  } catch (err) {
    logger.error('fetchContentByTopic failed', { topic, err });
    return generateWithGroq('motivational');
  }
};