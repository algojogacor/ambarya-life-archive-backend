// backend/src/services/scraper.service.ts

import axios from 'axios';
import logger from './logger.service';

export interface ScrapedContent {
  content: string;
  sourceUrl?: string;
  sourceName?: string;
  imageUrl?: string; // ← gambar dari artikel/post
}

// ─── RSS FEEDS ────────────────────────────────────────────────────────────────

const RSS_FEEDS: Record<string, { url: string; name: string }[]> = {
  news: [
    { url: 'https://www.cnnindonesia.com/rss', name: 'CNN Indonesia' },
    { url: 'https://rss.detik.com/index.php/detikcom', name: 'Detik.com' },
    { url: 'https://www.kompas.com/rss/headlines.xml', name: 'Kompas.com' },
    { url: 'https://www.tribunnews.com/rss', name: 'Tribun News' },
  ],
  tech: [
    { url: 'https://www.cnnindonesia.com/teknologi/rss', name: 'CNN Tech ID' },
    { url: 'https://feeds.feedburner.com/TechCrunch', name: 'TechCrunch' },
    { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge' },
  ],
  islamic: [
    { url: 'https://www.islampos.com/feed/', name: 'IslamPos' },
    { url: 'https://muslimafiyah.com/feed', name: 'Muslim Afiyah' },
    { url: 'https://almanhaj.or.id/feed', name: 'Al Manhaj' },
  ],
  life: [
    { url: 'https://www.cnnindonesia.com/gaya-hidup/rss', name: 'CNN Gaya Hidup' },
    { url: 'https://feeds.feedburner.com/PsychologyToday', name: 'Psychology Today' },
  ],
  entertainment: [
    { url: 'https://www.cnnindonesia.com/hiburan/rss', name: 'CNN Hiburan' },
    { url: 'https://www.tribunnews.com/seleb/rss', name: 'Tribun Seleb' },
  ],
};

// ─── PARSE RSS dengan ekstrak gambar ─────────────────────────────────────────

const extractImage = (itemContent: string): string | undefined => {
  // Coba dari enclosure (podcast/media RSS)
  const enclosure = itemContent.match(/<enclosure[^>]+url="([^"]+\.(jpg|jpeg|png|webp))"/i)?.[1];
  if (enclosure) return enclosure;

  // Coba dari media:content
  const mediaContent = itemContent.match(/<media:content[^>]+url="([^"]+\.(jpg|jpeg|png|webp))"/i)?.[1];
  if (mediaContent) return mediaContent;

  // Coba dari media:thumbnail
  const mediaThumbnail = itemContent.match(/<media:thumbnail[^>]+url="([^"]+)"/i)?.[1];
  if (mediaThumbnail) return mediaThumbnail;

  // Coba dari img tag di description/content
  const imgTag = itemContent.match(/<img[^>]+src="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i)?.[1];
  if (imgTag) return imgTag;

  // Coba dari content:encoded
  const contentEncoded = itemContent.match(/<content:encoded>[\s\S]*?<img[^>]+src="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i)?.[1];
  if (contentEncoded) return contentEncoded;

  return undefined;
};

// Bersihkan HTML tags dan entities secara menyeluruh
const stripHtml = (html: string): string => {
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') // unwrap CDATA
    .replace(/<[^>]+>/g, ' ')                      // hapus semua HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s{2,}/g, ' ')                       // multiple spaces jadi satu
    .trim();
};

const parseRSS = (xml: string): { title: string; link: string; description: string; imageUrl?: string }[] => {
  const items: { title: string; link: string; description: string; imageUrl?: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemContent = match[1];

    const titleRaw = itemContent.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
    const title = stripHtml(titleRaw);

    const link = itemContent.match(/<link>(.*?)<\/link>/)?.[1]?.trim() || '';

    const descRaw = itemContent.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '';
    const description = stripHtml(descRaw).substring(0, 280);

    const imageUrl = extractImage(itemContent);

    if (title) items.push({ title, link, description, imageUrl });
  }

  return items.slice(0, 10);
};

export const fetchFromRSS = async (topic: string): Promise<ScrapedContent[]> => {
  const feeds = RSS_FEEDS[topic] || RSS_FEEDS.news;
  const results: ScrapedContent[] = [];

  for (const feed of feeds) {
    try {
      const response = await axios.get(feed.url, {
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AmbaryaBot/1.0; +https://ambarya.app)' },
      });

      const items = parseRSS(response.data as string);
      for (const item of items.slice(0, 3)) {
        const content = item.description
          ? `${item.title}\n\n${item.description}`
          : item.title;

        results.push({
          content,
          sourceUrl: item.link,
          sourceName: feed.name,
          imageUrl: item.imageUrl,
        });
      }
    } catch (err) {
      logger.warn('RSS fetch failed', { feed: feed.name });
    }

    if (results.length >= 5) break;
  }

  return results;
};

// ─── QUOTES API ───────────────────────────────────────────────────────────────

export const fetchQuote = async (): Promise<ScrapedContent | null> => {
  try {
    const response = await axios.get('https://api.quotable.io/random', {
      timeout: 5000,
      params: { tags: 'motivational|inspirational|life|wisdom' },
    });
    const { content, author } = response.data as any;
    return {
      content: `"${content}"\n\n— ${author}`,
      sourceName: 'Quotable',
      imageUrl: undefined, // Quote tidak ada gambar
    };
  } catch {
    const fallbacks = [
      '"Hidup bukan tentang menemukan dirimu. Hidup adalah tentang menciptakan dirimu."\n\n— George Bernard Shaw',
      '"Jangan tunggu. Waktunya tidak akan pernah tepat."\n\n— Napoleon Hill',
      '"Kesuksesan adalah jumlah dari usaha-usaha kecil yang diulangi hari demi hari."\n\n— Robert Collier',
      '"Satu-satunya cara untuk melakukan pekerjaan yang luar biasa adalah mencintai apa yang kamu lakukan."\n\n— Steve Jobs',
      '"Mimpi besar, mulai kecil, tapi yang paling penting — mulai sekarang."\n\n— Simon Sinek',
      '"Kegagalan adalah bumbu yang memberikan rasa pada kesuksesan."\n\n— Truman Capote',
      '"Orang yang berhenti belajar adalah orang yang sudah tua, meski berumur 20 tahun."\n\n— Henry Ford',
    ];
    return {
      content: fallbacks[Math.floor(Math.random() * fallbacks.length)],
      sourceName: 'Quotes',
    };
  }
};

// ─── ISLAMIC CONTENT ──────────────────────────────────────────────────────────

const ISLAMIC_CONTENT = [
  'Barangsiapa yang bertakwa kepada Allah, niscaya Dia akan mengadakan baginya jalan keluar. (QS. At-Talaq: 2)',
  'Dan Dia memberinya rezeki dari arah yang tidak disangka-sangka. (QS. At-Talaq: 3)',
  'Sesungguhnya bersama kesulitan ada kemudahan. (QS. Al-Insyirah: 6)',
  'Allah tidak membebani seseorang melainkan sesuai dengan kesanggupannya. (QS. Al-Baqarah: 286)',
  'Ingatlah, hanya dengan mengingat Allah hati menjadi tenteram. (QS. Ar-Ra\'d: 28)',
  'Janganlah kamu bersedih, sesungguhnya Allah bersama kita. (QS. At-Taubah: 40)',
  'Dan janganlah kamu berputus asa dari rahmat Allah. (QS. Az-Zumar: 53)',
  'Sesungguhnya Allah bersama orang-orang yang sabar. (QS. Al-Baqarah: 153)',
];

export const fetchIslamicContent = async (): Promise<ScrapedContent> => {
  const rssContent = await fetchFromRSS('islamic');
  if (rssContent.length > 0) {
    return rssContent[Math.floor(Math.random() * rssContent.length)];
  }
  const content = ISLAMIC_CONTENT[Math.floor(Math.random() * ISLAMIC_CONTENT.length)];
  return { content, sourceName: 'Al-Quran' };
};

// ─── RANDOM FACT ─────────────────────────────────────────────────────────────

export const fetchRandomFact = async (): Promise<ScrapedContent | null> => {
  try {
    const response = await axios.get('https://uselessfacts.jsph.pl/api/v2/facts/random', {
      timeout: 5000,
      params: { language: 'en' },
    });
    return {
      content: `💡 Fakta: ${(response.data as any).text}`,
      sourceName: 'UselessFacts',
      sourceUrl: (response.data as any).source_url,
    };
  } catch {
    return null;
  }
};

// ─── MAIN FETCH BY TOPIC ──────────────────────────────────────────────────────

export const fetchContentByTopic = async (topic: string): Promise<ScrapedContent | null> => {
  try {
    switch (topic) {
      case 'news':
      case 'tech':
      case 'life':
      case 'entertainment': {
        const items = await fetchFromRSS(topic);
        if (items.length > 0) return items[Math.floor(Math.random() * items.length)];
        return fetchQuote();
      }
      case 'quotes':
      case 'motivational':
        return fetchQuote();
      case 'islamic':
      case 'dakwah':
        return fetchIslamicContent();
      case 'facts':
        return (await fetchRandomFact()) ?? fetchQuote();
      default: {
        const randomTopic = ['quotes', 'news', 'islamic', 'facts'][Math.floor(Math.random() * 4)];
        return fetchContentByTopic(randomTopic);
      }
    }
  } catch (err) {
    logger.error('fetchContentByTopic failed', { topic, err });
    return null;
  }
};