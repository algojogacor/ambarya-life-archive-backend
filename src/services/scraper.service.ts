// backend/src/services/scraper.service.ts

import axios from 'axios';
import logger from './logger.service';

export interface ScrapedContent {
  content: string;
  sourceUrl?: string;
  sourceName?: string;
  imageUrl?: string;
}

const GROQ_KEYS = [
  process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3, process.env.GROQ_API_KEY_4,
].filter(Boolean) as string[];

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
let keyIndex = 0;

const callGroq = async (systemPrompt: string, userPrompt: string, maxTokens = 400): Promise<string | null> => {
  if (GROQ_KEYS.length === 0) return null;
  const key = GROQ_KEYS[keyIndex++ % GROQ_KEYS.length];
  try {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: MODEL,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      max_tokens: maxTokens, temperature: 0.8,
    }, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 12000 });
    return res.data.choices[0].message.content.trim();
  } catch (err: any) {
    logger.warn('Groq call failed', { err: err.message });
    return null;
  }
};

const RSS_FEEDS: Record<string, { url: string; name: string }[]> = {
  news:          [{ url: 'https://rss.detik.com/index.php/detikcom', name: 'Detik.com' }, { url: 'https://www.cnnindonesia.com/rss', name: 'CNN Indonesia' }, { url: 'https://www.kompas.com/rss/headlines.xml', name: 'Kompas.com' }],
  tech:          [{ url: 'https://www.cnnindonesia.com/teknologi/rss', name: 'CNN Tech ID' }, { url: 'https://feeds.feedburner.com/TechCrunch', name: 'TechCrunch' }],
  islamic:       [{ url: 'https://www.islampos.com/feed/', name: 'IslamPos' }],
  life:          [{ url: 'https://www.cnnindonesia.com/gaya-hidup/rss', name: 'CNN Gaya Hidup' }],
  entertainment: [{ url: 'https://www.cnnindonesia.com/hiburan/rss', name: 'CNN Hiburan' }, { url: 'https://www.tribunnews.com/seleb/rss', name: 'Tribun Seleb' }],
  economy:       [{ url: 'https://www.cnnindonesia.com/ekonomi/rss', name: 'CNN Ekonomi' }, { url: 'https://rss.detik.com/index.php/detikfinance', name: 'Detik Finance' }],
  sports:        [{ url: 'https://www.cnnindonesia.com/olahraga/rss', name: 'CNN Olahraga' }, { url: 'https://rss.detik.com/index.php/detikspot', name: 'Detik Sport' }],
  government:    [{ url: 'https://setkab.go.id/feed/', name: 'Setkab RI' }, { url: 'https://www.cnnindonesia.com/nasional/rss', name: 'CNN Nasional' }, { url: 'https://rss.detik.com/index.php/detiknews', name: 'Detik News' }],
  health:        [{ url: 'https://www.cnnindonesia.com/gaya-hidup/rss', name: 'CNN Kesehatan' }],
  environment:   [{ url: 'https://www.cnnindonesia.com/nasional/rss', name: 'CNN Lingkungan' }],
};

const TOPIC_PROMPTS: Record<string, string> = {
  news:          'Kamu editor berita. Tulis ulang jadi post sosial media informatif dan natural dalam Bahasa Indonesia. 4-6 kalimat. Tanpa HTML atau URL.',
  tech:          'Kamu tech creator. Tulis ulang jadi post teknologi yang menarik untuk anak muda dalam Bahasa Indonesia. 4-6 kalimat.',
  islamic:       'Kamu kreator dakwah. Tulis ulang jadi post hikmah yang inspiratif dalam Bahasa Indonesia. 4-6 kalimat penuh makna.',
  life:          'Kamu life coach digital. Tulis ulang jadi tips kehidupan yang relatable dalam Bahasa Indonesia. 4-6 kalimat.',
  entertainment: 'Kamu entertainment writer. Tulis ulang jadi post hiburan yang asik dalam Bahasa Indonesia. 4-6 kalimat.',
  economy:       'Kamu financial educator. Tulis ulang jadi post ekonomi yang mudah dipahami dalam Bahasa Indonesia. 4-6 kalimat.',
  sports:        'Kamu sports journalist. Tulis ulang jadi post olahraga yang semangat dalam Bahasa Indonesia. 4-6 kalimat.',
  government:    'Kamu jurnalis pemerintahan Indonesia yang objektif. Tulis ulang berita kebijakan/program pemerintah jadi post sosial media yang mudah dipahami masyarakat, netral, dan informatif dalam Bahasa Indonesia. 5-7 kalimat. Mulai dengan konteks yang jelas.',
  health:        'Kamu health creator. Tulis ulang jadi tips kesehatan yang praktis dalam Bahasa Indonesia. 4-6 kalimat.',
  environment:   'Kamu environmental activist. Tulis ulang jadi post yang menginspirasi kepedulian alam dalam Bahasa Indonesia. 4-6 kalimat.',
  quotes:        'HANYA output kontennya. Buat 1 quote motivasi original + penjelasan maknanya dalam Bahasa Indonesia. 4-5 kalimat.',
  motivational:  'HANYA output kontennya. Buat pesan motivasi yang powerful dan relatable dalam Bahasa Indonesia. 4-5 kalimat.',
  facts:         'HANYA output kontennya. Mulai "Tahukah kamu?" lalu ceritakan 1 fakta unik dengan detail dalam Bahasa Indonesia. 4-5 kalimat.',
  education:     'HANYA output kontennya. Bagikan 1 pengetahuan edukatif yang menarik dalam Bahasa Indonesia. 4-5 kalimat.',
  culture:       'HANYA output kontennya. Ceritakan 1 fakta menarik tentang budaya Indonesia dalam Bahasa Indonesia. 4-5 kalimat.',
  food:          'HANYA output kontennya. Ceritakan hal menarik tentang kuliner Nusantara dalam Bahasa Indonesia. 4-5 kalimat.',
  art:           'HANYA output kontennya. Bagikan apresiasi seni atau kreativitas yang menarik dalam Bahasa Indonesia. 4-5 kalimat.',
  finance:       'HANYA output kontennya. Bagikan tips keuangan praktis untuk pemula dalam Bahasa Indonesia. 4-5 kalimat.',
  nature:        'HANYA output kontennya. Ceritakan keindahan alam atau fakta alam yang menakjubkan dalam Bahasa Indonesia. 4-5 kalimat.',
  dakwah:        'HANYA output kontennya. Bagikan ayat Al-Quran atau hadits relevan beserta penjelasannya dalam Bahasa Indonesia. 4-5 kalimat.',
};

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

const stripHtml = (html: string): string =>
  html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();

const parseRSS = (xml: string) => {
  const items: { title: string; link: string; description: string; imageUrl?: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const c = match[1];
    const title = stripHtml(c.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
    const link = c.match(/<link>(.*?)<\/link>/)?.[1]?.trim() || '';
    const description = stripHtml(c.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '').substring(0, 600);
    const imageUrl = extractImage(c);
    if (title) items.push({ title, link, description, imageUrl });
  }
  return items.slice(0, 8);
};

export const fetchFromRSS = async (topic: string): Promise<ScrapedContent[]> => {
  const feeds = RSS_FEEDS[topic] || RSS_FEEDS.news;
  const results: ScrapedContent[] = [];
  const systemPrompt = TOPIC_PROMPTS[topic] || TOPIC_PROMPTS.news;

  for (const feed of feeds) {
    try {
      const response = await axios.get(feed.url, {
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AmbaryaBot/1.0)' },
      });
      const items = parseRSS(response.data as string);
      for (const item of items.slice(0, 2)) {
        const caption = await callGroq(systemPrompt, `Judul: ${item.title}\nDeskripsi: ${item.description}`, 450);
        if (!caption) continue;
        results.push({ content: caption, sourceUrl: item.link, sourceName: feed.name, imageUrl: item.imageUrl });
        if (results.length >= 3) break;
      }
    } catch {
      logger.warn('RSS fetch failed', { feed: feed.name });
    }
    if (results.length >= 3) break;
  }
  return results;
};

export const generateWithGroq = async (topic: string): Promise<ScrapedContent | null> => {
  const systemPrompt = TOPIC_PROMPTS[topic] || TOPIC_PROMPTS.motivational;
  const content = await callGroq(systemPrompt, `Buat konten untuk topik: ${topic}`, 450);
  if (!content) return null;
  return { content, sourceName: undefined };
};

export const fetchContentByTopic = async (topic: string): Promise<ScrapedContent | null> => {
  try {
    const rssTopics = ['news', 'tech', 'life', 'entertainment', 'economy', 'sports', 'government', 'health', 'environment', 'islamic'];
    if (rssTopics.includes(topic)) {
      const items = await fetchFromRSS(topic);
      if (items.length > 0) return items[Math.floor(Math.random() * items.length)];
    }
    return generateWithGroq(topic);
  } catch (err) {
    logger.error('fetchContentByTopic failed', { topic, err });
    return generateWithGroq('motivational');
  }
};