// backend/src/services/confess.service.ts

import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import type { InValue } from '@libsql/client';
import db from '../db/database';
import logger from './logger.service';
import { triggerNewComment } from './pusher.service';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const a = (v: unknown): InValue => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return String(v);
};

const str = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return String(v);
};

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const randomDelay = (minMs: number, maxMs: number) =>
  new Promise(resolve => setTimeout(resolve, randInt(minMs, maxMs)));

// ─── GROQ CLIENT — PRIORITAS ──────────────────────────────────────────────────
//
// Bisikan Jiwa mendapat PRIORITAS TERTINGGI dalam penggunaan AI.
// Strategi:
//   1. Selalu coba key pertama dulu (GROQ_API_KEY)
//   2. Jika gagal (rate limit / error), fallback ke key berikutnya
//   3. Bot postingan biasa pakai round-robin dari key ke-2 dst
//      sehingga key pertama selalu "fresh" untuk Bisikan Jiwa
//
// Ini memastikan AI reply & polish confess tidak terblokir rate limit
// yang disebabkan oleh aktivitas bot postingan biasa.

const GROQ_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
].filter(Boolean) as string[];

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

/**
 * Groq call dengan PRIORITAS — coba dari key pertama,
 * fallback ke key berikutnya jika gagal.
 * Digunakan HANYA untuk Bisikan Jiwa.
 */
const callGroqPriority = async (
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 600
): Promise<string | null> => {
  if (GROQ_KEYS.length === 0) return null;

  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const key = GROQ_KEYS[i];
    try {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model:       MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt   },
          ],
          max_tokens:  maxTokens,
          temperature: 0.85,
        },
        {
          headers: {
            Authorization:  `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );
      return res.data.choices[0].message.content.trim();
    } catch (err: any) {
      const isRateLimit = err?.response?.status === 429;
      logger.warn(`Confess: Groq key[${i}] failed${isRateLimit ? ' (rate limit)' : ''}`, {
        err: err.message,
      });
      // Kalau rate limit atau timeout, coba key berikutnya
      if (i < GROQ_KEYS.length - 1) {
        logger.info(`Confess: Falling back to key[${i + 1}]`);
        continue;
      }
    }
  }

  logger.error('Confess: All Groq keys failed');
  return null;
};

// ─── MOOD TAGS ────────────────────────────────────────────────────────────────

export const MOOD_TAGS = ['sedih', 'kesal', 'bingung', 'terharu', 'cemas'] as const;
export type MoodTag = typeof MOOD_TAGS[number];

export const MOOD_EMOJI: Record<MoodTag, string> = {
  sedih:   '😔',
  kesal:   '😤',
  bingung: '😕',
  terharu: '🥹',
  cemas:   '😰',
};

// ─── DISPLAY NAME GENERATOR ───────────────────────────────────────────────────

export const generateDisplayName = (realName: string): string => {
  const firstName = realName.trim().split(' ')[0];
  if (!firstName) return 'S*****';
  const firstChar = firstName[0].toUpperCase();
  const starCount = Math.min(Math.max(firstName.length - 1, 3), 7);
  return `Cerita dari ${firstChar}${'*'.repeat(starCount)}`;
};

const BOT_NAME_POOL = [
  'Arya', 'Reza', 'Nadia', 'Sari', 'Dika', 'Maya', 'Fariz', 'Lina',
  'Budi', 'Citra', 'Hendra', 'Putri', 'Yoga', 'Dewi', 'Andi', 'Nurul',
  'Galih', 'Tio', 'Rizky', 'Ayu', 'Bagas', 'Shinta', 'Wahyu', 'Rina',
  'Hafiz', 'Salma', 'Kevin', 'Tania', 'Faris', 'Mira',
];

export const generateBotDisplayName = (): string => {
  const name = BOT_NAME_POOL[Math.floor(Math.random() * BOT_NAME_POOL.length)];
  return generateDisplayName(name);
};

// ─── BOT PROMPT POOL ──────────────────────────────────────────────────────────

const BOT_CONFESS_PROMPTS = [
  // 💔 Deep Emotion
  'Tulis cerita pendek tentang momen kamu merasa nggak benar-benar dimengerti. Jangan terlalu rapi—biarkan ceritanya agak loncat-loncat, seperti orang yang lagi curhat. Tambahkan detail kecil (tempat, suasana, atau kejadian spesifik). Gunakan kata ganti orang pertama yang terasa paling natural buat karakter ini—boleh gue, aku, saya, aing, atau lainnya.',

  'Ceritakan momen ketika kamu terlihat baik-baik saja di depan orang lain, tapi sebenarnya lagi kacau. Jangan langsung jelaskan perasaanmu—tunjukkan lewat kejadian atau kebiasaan kecil. Boleh pakai bahasa santai campur formal, sesuaikan saja.',

  'Tulis tentang seseorang yang masih kamu pikirkan sampai sekarang. Jangan terlalu jelas menjelaskan kenapa—biarkan sebagian terasa "nggantung" seperti perasaan yang belum selesai. Gunakan kata ganti yang paling pas buat nada ceritanya.',

  'Ceritakan rasa lelah yang kamu rasakan, tapi bukan dengan kata "lelah". Gambarkan lewat hal-hal kecil yang kamu lakukan atau rasakan sehari-hari. Bisa pakai gue, aku, atau bahkan saya kalau nadanya lebih formal.',

  'Tulis tentang sesuatu yang ingin banget kamu dengar dari seseorang, tapi nggak pernah kamu dapatkan. Buat seolah-olah kamu lagi ngomong ke diri sendiri. Pilih kata ganti yang terasa paling jujur.',

  // 🧠 Self Reflection
  'Tulis tentang dirimu yang dulu, tapi dengan gaya santai seolah kamu lagi ngobrol sendiri. Boleh ada kebingungan atau keraguan, nggak harus semuanya jelas. Bebas pakai gue, aku, atau apapun yang cocok.',

  'Ceritakan kebiasaan buruk yang kamu tahu nggak baik, tapi masih kamu lakukan. Tambahkan alasan yang jujur, walaupun terdengar "jelek". Gunakan bahasa sehari-hari yang natural.',

  'Tulis tentang sesuatu yang sering kamu hindari. Jangan langsung bilang takut, tapi tunjukkan lewat tindakan atau keputusanmu. Boleh campur bahasa gaul dan formal.',

  'Ceritakan satu keputusan yang masih kamu pikirkan sampai sekarang. Biarkan ceritanya sedikit berantakan dan nggak harus ada kesimpulan. Pilih kata ganti yang terasa paling pas.',

  'Tulis tentang hal yang sebenarnya paling kamu takutkan, tapi dengan gaya seolah kamu belum sepenuhnya mau mengakuinya. Bebas dalam pilihan kata dan kata ganti.',

  // 🫂 Healing & Release
  'Tulis seolah kamu lagi menulis pesan yang tidak akan pernah dikirim ke seseorang. Bebas, jujur, dan nggak perlu disusun rapi. Gunakan kata ganti yang paling terasa "kamu banget"—gue, aku, saya, aing.',

  'Ceritakan sesuatu yang ingin kamu maafkan, tapi kamu sendiri masih ragu. Boleh ada konflik dalam pikiranmu. Bahasa bebas, campur-campur oke.',

  'Tulis tentang hal yang sudah lama kamu pendam. Jangan langsung ke inti—biarkan ceritanya pelan-pelan terbuka. Pilih gaya bahasa yang paling terasa natural.',

  'Ceritakan luka lama tanpa menyebutnya secara langsung. Gunakan kejadian atau kenangan kecil sebagai pengganti. Kata ganti bebas.',

  'Tulis tentang apa yang sebenarnya kamu butuhkan saat ini, tapi dengan gaya seolah kamu sendiri juga belum yakin. Boleh formal, boleh santai.',

  // 🌱 Growth & Direction
  'Tulis tentang kehidupan yang kamu inginkan, tapi sertakan juga keraguan kenapa kamu belum sampai ke sana. Gunakan kata ganti yang paling cocok—tidak harus aku terus.',

  'Ceritakan satu langkah kecil yang sebenarnya bisa kamu lakukan, tapi entah kenapa selalu kamu tunda. Bahasa bebas, sesantai yang dirasa pas.',

  'Tulis tentang perubahan yang kamu inginkan, tapi jujur juga tentang rasa malas atau takutmu. Boleh pakai gue, aku, saya, aing, atau lainnya.',

  'Bayangkan versi dirimu di masa depan, tapi buat terasa realistis—nggak perlu sempurna. Pilih kata ganti yang bikin ceritanya lebih hidup.',

  'Tulis satu hal kecil yang kamu syukuri hari ini, tapi jangan dibuat terlalu indah—biarkan sederhana dan apa adanya. Kata ganti bebas.',

  // ⚡ Contrast Emotion
  'Ceritakan hari yang berat, tapi selipkan satu momen kecil yang diam-diam bikin kamu sedikit lega. Gunakan kata ganti yang paling natural buat nada hari itu.',

  'Tulis tentang momen kecil yang mungkin orang lain anggap biasa, tapi entah kenapa terasa penting buatmu. Bebas pilih kata ganti.',

  'Ceritakan sesuatu yang dulu kamu anggap masalah besar, tapi sekarang terasa berbeda. Boleh pakai bahasa lama vs sekarang yang berbeda gayanya.',

  'Tulis tentang seseorang yang selalu ada, tapi kamu jarang benar-benar menyadarinya. Kata ganti bebas—pilih yang paling hangat terasa.',

  'Ceritakan kenapa kamu masih bertahan sampai hari ini, tapi jangan dibuat terlalu heroik—biarkan jujur saja. Bahasa dan kata ganti bebas.',

  // 🎭 Real-life Scenario
  'Bayangkan kamu bisa bicara tanpa takut dihakimi. Tulis apa yang akan kamu katakan, tapi dengan gaya spontan, seperti belum sempat dipikirkan matang. Kata ganti bebas sesuai karakter.',

  'Jika kamu bisa mengulang satu hari, ceritakan hari itu secara detail kecil—bukan hanya alasannya. Gunakan kata ganti yang paling hidup.',

  'Tulis seolah ada seseorang yang benar-benar memahami kamu. Apa yang akan kamu ceritakan ke dia? Bahasa dan kata ganti bebas.',

  'Tulis surat untuk dirimu sendiri di masa lalu, tapi jangan terlalu bijak—biarkan terasa seperti kamu yang sekarang. Pilih kata ganti yang biasa kamu pakai sehari-hari.',

  'Bayangkan semua tekanan hilang hari ini. Ceritakan hal pertama yang kamu lakukan, sekecil apapun itu. Kata ganti bebas.',
];

// ─── AI POLISH ────────────────────────────────────────────────────────────────

const POLISH_SYSTEM_PROMPT = `Kamu membantu teman menceritakan ulang curhatannya.
Tugasmu bukan merapikan — tugasmu membuat ini terasa lebih MANUSIAWI dan RAW.

Aturan WAJIB:
- JANGAN ubah fakta, kejadian, atau emosi intinya
- Kata ganti orang pertama BEBAS sesuai nada asli ceritanya: gue, aku, saya, aing, w, atau lainnya. Jangan paksa semua jadi "aku"
- DILARANG struktur linear: masalah → refleksi → harapan. Manusia tidak curhat seperti itu
- DILARANG kalimat sadar-diri seperti: "aku menyadari bahwa...", "gue tau ini nggak bener...", "saya harus belajar..."
- TAMBAHKAN detail kecil yang konkret dan spesifik kalau bisa (tempat, benda, situasi nyata)
- Boleh loncat-loncat, kontradiktif, atau tidak ada kesimpulan — itu justru lebih nyata
- Boleh campur bahasa formal dan gaul kalau memang begitu aslinya
- Tidak harus panjang. Pendek dan padat lebih bagus dari panjang tapi template
- Tidak harus ada resolusi atau harapan di akhir. Boleh menggantung
- Gunakan bahasa sehari-hari, bukan formal
- Jangan terlalu terstruktur — satu paragraf loncat ke topik lain itu wajar
- Hindari kesimpulan yang terlalu jelas
- Sisakan sedikit ketidakjelasan atau emosi yang belum selesai
- Gunakan detail kecil (tempat, waktu, kebiasaan) untuk bikin cerita terasa nyata
- Output HANYA teks ceritanya saja`;

export const polishConfess = async (rawContent: string): Promise<string> => {
  const polished = await callGroqPriority(
    POLISH_SYSTEM_PROMPT,
    `Susun ulang cerita ini:\n\n${rawContent}`,
    800
  );
  return polished || rawContent;
};

// ─── BOT GENERATE CONFESS ─────────────────────────────────────────────────────

const BOT_GENERATE_SYSTEM_PROMPT = `Kamu adalah manusia biasa yang sedang curhat anonim di internet.
Tulis curhatan dari sudut pandang orang pertama.

Yang HARUS ada:
- Kata ganti orang pertama yang bervariasi dan natural: gue, aku, saya, aing, w — pilih yang paling cocok untuk karakter dan nada ceritanya. JANGAN selalu pakai "aku"
- Minimal 1-2 detail kecil yang spesifik dan konkret (contoh: "waktu di angkot", "pas lagi makan", "tiba-tiba inget waktu kelas 3 SMA")
- Emosi yang tidak selalu konsisten — kadang marah, tapi juga kangen, tapi juga bingung sendiri
- Kalimat yang tidak selalu selesai dengan rapi
- Boleh campur bahasa gaul dan formal sesuai karakter

Yang DILARANG:
- Selalu pakai "aku" — itu justru terasa robotic
- Struktur: latar → masalah → refleksi → harapan
- Kalimat template seperti "aku menyadari", "gue tau ini salah", "semoga suatu hari nanti"
- Paragraf yang terlalu rapi dan seimbang
- Kesimpulan atau moral di akhir
- Bahasa terlalu formal atau kaku
- Output HANYA teks ceritanya saja, tanpa label apapun

Tambahan:
- Gunakan bahasa sehari-hari, bukan formal
- Jangan terlalu terstruktur — boleh loncat-loncat
- Hindari kesimpulan yang terlalu jelas
- Sisakan sedikit ketidakjelasan atau emosi yang belum selesai
- Gunakan detail kecil (tempat, waktu, kebiasaan) supaya terasa nyata`;

export const generateBotConfess = async (): Promise<string | null> => {
  const prompt = BOT_CONFESS_PROMPTS[
    Math.floor(Math.random() * BOT_CONFESS_PROMPTS.length)
  ];
  // Bot generate pakai priority juga — konten confess tetap prioritas
  return callGroqPriority(BOT_GENERATE_SYSTEM_PROMPT, prompt, 800);
};

// ─── BOT REFRAME RSS → CONFESS ────────────────────────────────────────────────

const REFRAME_SYSTEM_PROMPT = `Kamu adalah orang biasa yang curhat anonim.
Berdasarkan tema artikel berikut, tulis curhatan personal — bukan laporan, bukan rangkuman.
JANGAN sebut sumber atau nama media apapun.

Yang harus terasa:
- Sudut pandang orang yang hidupnya tersentuh oleh tema itu, bukan pengamat
- Ada detail spesifik kecil yang personal (tempat, waktu, orang tertentu tanpa nama jelas)
- Emosi yang berantakan, bukan rapi
- Boleh tidak ada solusi atau harapan di akhir
- Gunakan bahasa sehari-hari, bukan formal
- Jangan terlalu terstruktur
- Hindari kesimpulan yang terlalu jelas
- Sisakan sedikit ketidakjelasan atau emosi yang belum selesai
- Gunakan detail kecil (tempat, waktu, kebiasaan)
- Output HANYA teks ceritanya saja`;

export const reframeRSSToConfess = async (
  title: string,
  description: string
): Promise<string | null> => {
  return callGroqPriority(
    REFRAME_SYSTEM_PROMPT,
    `Judul artikel: ${title}\nIsi: ${description}`,
    800
  );
};

// ─── AI REPLY ─────────────────────────────────────────────────────────────────

const AI_REPLY_SYSTEM_PROMPT = `Kamu adalah "Bisikan Jiwa" — pendengar empatik yang ada di sini untuk mendengarkan tanpa menghakimi.
Cara menjawab:
- Hangat, empatik, tidak formal
- Validasi perasaan yang disampaikan
- Kadang balik bertanya dengan lembut untuk memancing diskusi lebih dalam
- Jangan beri nasihat yang tidak diminta
- Jangan terkesan seperti psikolog atau bot — terasa seperti teman yang benar-benar mendengarkan
- Pendek: 1-3 kalimat saja
- Output HANYA teks balasan, tanpa label apapun`;

export const generateAIReply = async (confessId: string): Promise<string | null> => {
  try {
    const postResult = await db.execute({
      sql:  'SELECT polished_content, mood_tag FROM confess_posts WHERE id = ?',
      args: [a(confessId)],
    });
    if (postResult.rows.length === 0) return null;
    const post = postResult.rows[0] as any;

    const ctxResult = await db.execute({
      sql:  'SELECT context_summary FROM confess_ai_context WHERE confess_id = ?',
      args: [a(confessId)],
    });
    const contextSummary = ctxResult.rows.length > 0
      ? str(ctxResult.rows[0].context_summary)
      : '';

    const commentsResult = await db.execute({
      sql: `SELECT content FROM confess_comments
            WHERE confess_id = ? AND is_ai_reply = 0
            ORDER BY created_at DESC LIMIT 3`,
      args: [a(confessId)],
    });
    const recentComments = (commentsResult.rows as any[])
      .map(r => str(r.content))
      .reverse()
      .join('\n');

    const userPrompt = `
Cerita yang dibagikan (mood: ${str(post.mood_tag)}):
"${str(post.polished_content)}"

${contextSummary ? `Ringkasan diskusi sejauh ini:\n${contextSummary}` : ''}

${recentComments ? `Komentar terbaru:\n${recentComments}` : ''}

Balas dengan empati.`.trim();

    const reply = await callGroqPriority(AI_REPLY_SYSTEM_PROMPT, userPrompt, 200);
    if (!reply) return null;

    await _updateContextSummary(confessId, str(post.polished_content), reply, recentComments);
    return reply;
  } catch (err) {
    logger.error('generateAIReply failed', { confessId, err });
    return null;
  }
};

// ─── UPDATE CONTEXT SUMMARY ───────────────────────────────────────────────────

const _updateContextSummary = async (
  confessId: string,
  originalPost: string,
  lastAIReply: string,
  recentComments: string
): Promise<void> => {
  try {
    const existing = await db.execute({
      sql:  'SELECT context_summary, total_comments FROM confess_ai_context WHERE confess_id = ?',
      args: [a(confessId)],
    });

    const totalComments = existing.rows.length > 0
      ? Number((existing.rows[0] as any).total_comments) + 1
      : 1;

    const summaryPrompt = `
Cerita asli: "${originalPost.substring(0, 200)}"
Komentar pengguna terbaru: "${recentComments.substring(0, 300)}"
Balasan AI terakhir: "${lastAIReply}"

Buat ringkasan singkat (max 3 kalimat) tentang apa yang sudah dibahas dalam diskusi ini,
agar AI tidak lupa konteksnya di balasan berikutnya.
Output HANYA ringkasannya saja.`.trim();

    const newSummary = await callGroqPriority(
      'Kamu adalah asisten yang membuat ringkasan konteks diskusi.',
      summaryPrompt,
      150
    );

    if (existing.rows.length === 0) {
      await db.execute({
        sql: `INSERT INTO confess_ai_context (id, confess_id, context_summary, total_comments, last_updated)
              VALUES (?, ?, ?, ?, datetime('now'))`,
        args: [a(uuidv4()), a(confessId), a(newSummary || ''), a(totalComments)],
      });
    } else {
      await db.execute({
        sql: `UPDATE confess_ai_context
              SET context_summary = ?, total_comments = ?, last_updated = datetime('now')
              WHERE confess_id = ?`,
        args: [a(newSummary || ''), a(totalComments), a(confessId)],
      });
    }
  } catch (err) {
    logger.error('_updateContextSummary failed', { confessId, err });
  }
};

// ─── PROCESS AI REPLY QUEUE ───────────────────────────────────────────────────

export const processAIReplyQueue = async (): Promise<void> => {
  try {
    const queue = await db.execute({
      sql: `SELECT * FROM confess_reply_queue
            WHERE processed = 0
              AND process_after <= datetime('now')
            LIMIT 10`,
      args: [],
    });

    if (queue.rows.length === 0) return;

    logger.info(`Confess: Processing ${queue.rows.length} AI reply(s)`);

    for (const item of queue.rows as any[]) {
      try {
        const postCheck = await db.execute({
          sql:  'SELECT id, ai_replied FROM confess_posts WHERE id = ?',
          args: [a(str(item.confess_id))],
        });
        if (postCheck.rows.length === 0) {
          await _markQueueProcessed(str(item.id));
          continue;
        }

        const post         = postCheck.rows[0] as any;
        const isFirstReply = post.ai_replied === 0;

        if (!isFirstReply && Math.random() > 0.5) {
          await _markQueueProcessed(str(item.id));
          continue;
        }

        const reply = await generateAIReply(str(item.confess_id));
        if (!reply) {
          await _markQueueProcessed(str(item.id));
          continue;
        }

        const botResult = await db.execute({
          sql:  `SELECT user_id FROM social_profiles WHERE username = 'bisikanjiwa'`,
          args: [],
        });
        const botUserId = botResult.rows.length > 0
          ? str((botResult.rows[0] as any).user_id)
          : null;

        const aiCommentId = uuidv4();
        const aiCreatedAt = new Date().toISOString();

        await db.execute({
          sql: `INSERT INTO confess_comments (id, confess_id, user_id, content, is_ai_reply, created_at)
                VALUES (?, ?, ?, ?, 1, ?)`,
          args: [a(aiCommentId), a(str(item.confess_id)), a(botUserId), a(reply), a(aiCreatedAt)],
        });

        await db.execute({
          sql:  `UPDATE confess_posts SET ai_replied = 1 WHERE id = ?`,
          args: [a(str(item.confess_id))],
        });

        await _markQueueProcessed(str(item.id));
        logger.info('Confess: AI replied', { confessId: item.confess_id });

        // ✅ Pusher: broadcast balasan Bisikan Jiwa secara real-time (non-blocking)
        triggerNewComment(str(item.confess_id), {
          id:          aiCommentId,
          content:     reply,
          is_ai_reply: true,
          created_at:  aiCreatedAt,
          commenter: {
            username:     'bisikanjiwa',
            display_name: 'Bisikan Jiwa',
            avatar_url:   null,
            is_ai:        true,
          },
        }).catch(() => {});

        await randomDelay(2000, 5000);
      } catch (err) {
        logger.error('Confess: AI reply failed for queue item', { item, err });
        await _markQueueProcessed(str(item.id));
      }
    }
  } catch (err) {
    logger.error('processAIReplyQueue failed', { err });
  }
};

const _markQueueProcessed = async (queueId: string): Promise<void> => {
  await db.execute({
    sql:  `UPDATE confess_reply_queue SET processed = 1 WHERE id = ?`,
    args: [a(queueId)],
  });
};

// ─── BOT POST CONFESS ─────────────────────────────────────────────────────────

export const runBotConfessPost = async (): Promise<void> => {
  try {
    const botResult = await db.execute({
      sql:  `SELECT user_id FROM social_profiles WHERE username = 'bisikanjiwa'`,
      args: [],
    });
    if (botResult.rows.length === 0) {
      logger.warn('Confess Bot: @bisikanjiwa not found');
      return;
    }
    const botUserId = str((botResult.rows[0] as any).user_id);

    let content: string | null = null;

    // 40% scrape RSS → reframe, 60% generate murni
    if (Math.random() < 0.4) {
      content = await _scrapeAndReframe();
    }
    if (!content) {
      content = await generateBotConfess();
    }

    if (!content) {
      logger.warn('Confess Bot: Failed to generate content');
      return;
    }

    const mood        = MOOD_TAGS[Math.floor(Math.random() * MOOD_TAGS.length)];
    const displayName = generateBotDisplayName();
    const postId      = uuidv4();

    await db.execute({
      sql: `INSERT INTO confess_posts
              (id, user_id, original_content, polished_content, display_name, mood_tag, is_bot_post, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
      args: [a(postId), a(botUserId), a(content), a(content), a(displayName), a(mood)],
    });

    logger.info('Confess Bot: Posted', { postId, displayName, mood });
  } catch (err) {
    logger.error('runBotConfessPost failed', { err });
  }
};

// ─── SCRAPE RSS → REFRAME ─────────────────────────────────────────────────────

const RSS_SOURCES_FOR_CONFESS = [
  { url: 'https://www.cnnindonesia.com/gaya-hidup/rss', name: 'CNN Gaya Hidup' },
  { url: 'https://www.islampos.com/feed/',              name: 'IslamPos' },
];

const _scrapeAndReframe = async (): Promise<string | null> => {
  try {
    const source = RSS_SOURCES_FOR_CONFESS[
      Math.floor(Math.random() * RSS_SOURCES_FOR_CONFESS.length)
    ];

    const response = await axios.get(source.url, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AmbaryaBot/1.0)' },
    });

    const xml       = response.data as string;
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const items: { title: string; description: string }[] = [];
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const c           = match[1];
      const title       = _stripHtml(c.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
      const description = _stripHtml(
        c.match(/<description>([\s\S]*?)<\/description>/)?.[1] || ''
      ).substring(0, 400);
      if (title) items.push({ title, description });
    }

    if (items.length === 0) return null;
    const item = items[Math.floor(Math.random() * Math.min(items.length, 5))];
    return reframeRSSToConfess(item.title, item.description);
  } catch {
    return null;
  }
};

const _stripHtml = (html: string): string =>
  html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/\s{2,}/g, ' ').trim();

// ─── ENQUEUE AI REPLY ─────────────────────────────────────────────────────────

export const enqueueAIReply = async (
  confessId: string,
  triggerCommentId: string
): Promise<void> => {
  try {
    const delaySeconds = randInt(120, 300);
    const processAfter = new Date(Date.now() + delaySeconds * 1000).toISOString();

    await db.execute({
      sql: `INSERT INTO confess_reply_queue (id, confess_id, trigger_comment_id, process_after, created_at)
            VALUES (?, ?, ?, ?, datetime('now'))`,
      args: [a(uuidv4()), a(confessId), a(triggerCommentId), a(processAfter)],
    });

    logger.info('Confess: AI reply enqueued', { confessId, delaySeconds });
  } catch (err) {
    logger.error('enqueueAIReply failed', { confessId, err });
  }
};