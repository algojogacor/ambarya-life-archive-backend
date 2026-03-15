import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const GROQ_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
].filter(Boolean) as string[];

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

let currentKeyIndex = 0;

const callGroq = async (messages: any[], systemPrompt: string): Promise<string> => {
  const triedKeys = new Set<number>();

  while (triedKeys.size < GROQ_KEYS.length) {
    const keyIndex = currentKeyIndex % GROQ_KEYS.length;
    triedKeys.add(keyIndex);

    try {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: MODEL,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          max_tokens: 1024,
          temperature: 0.8,
        },
        {
          headers: {
            Authorization: `Bearer ${GROQ_KEYS[keyIndex]}`,
            'Content-Type': 'application/json',
          }
        }
      );

      return res.data.choices[0].message.content;
    } catch (err: any) {
      if (err.response?.status === 429) {
        // Rate limited, coba key berikutnya
        currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
        continue;
      }
      throw err;
    }
  }

  throw new Error('Semua Groq API key sedang rate limited');
};

// Daily reflection — otomatis komen tentang entry hari ini
export const getDailyReflection = async (entries: any[]): Promise<string> => {
  const entryContext = entries.map(e =>
    `[${new Date(e.created_at).toLocaleTimeString('id-ID')}] Mood: ${e.mood_label || '-'} | ${e.title || ''}: ${(e.content || '').substring(0, 200)}`
  ).join('\n');

  const systemPrompt = `Kamu adalah teman dekat yang hangat, jujur, dan peduli. Kamu mengenal kehidupan pengguna melalui catatan hariannya. 
Tugasmu adalah memberikan refleksi singkat dan personal tentang hari mereka — bukan menghakimi, tapi seperti teman yang genuinely care.
Gunakan bahasa Indonesia yang casual dan hangat. Maksimal 3-4 kalimat. Kadang boleh bercanda ringan kalau mood-nya bagus.`;

  const messages = [{
    role: 'user',
    content: `Ini catatan hariku hari ini:\n${entryContext}\n\nBerikan refleksi singkat tentang hariku.`
  }];

  return callGroq(messages, systemPrompt);
};

// Curhat mode — chat bebas dengan konteks hidup user
export const chat = async (
  message: string,
  history: { role: string; content: string }[],
  recentEntries: any[]
): Promise<string> => {
  const context = recentEntries.slice(0, 5).map(e =>
    `[${new Date(e.created_at).toLocaleDateString('id-ID')}] ${e.title || ''}: ${(e.content || '').substring(0, 150)}`
  ).join('\n');

  const systemPrompt = `Kamu adalah teman curhat yang bernama "Ambara" — hangat, empati, dan genuinely peduli.
Kamu tau kehidupan pengguna dari catatan-catatan mereka berikut:
${context}

Gunakan bahasa Indonesia yang casual. Jangan terlalu formal. Dengarkan dulu sebelum kasih saran.
Kalau pengguna sedang sedih, validasi perasaannya dulu. Kalau butuh saran, baru kasih saran yang thoughtful.
Jangan panjang-panjang, maksimal 4-5 kalimat per respons kecuali memang perlu lebih panjang.`;

  return callGroq(history.concat([{ role: 'user', content: message }]), systemPrompt);
};

// Memory aware — bot bisa jawab pertanyaan tentang masa lalu
export const askAboutMemory = async (question: string, entries: any[]): Promise<string> => {
  const context = entries.map(e =>
    `[${new Date(e.created_at).toLocaleDateString('id-ID')}] Mood: ${e.mood_label || '-'} | Tags: ${JSON.parse(e.tags || '[]').join(', ')} | ${e.title || ''}: ${(e.content || '').substring(0, 200)}`
  ).join('\n\n');

  const systemPrompt = `Kamu adalah asisten yang mengenal kehidupan pengguna dari catatan hariannya.
Jawab pertanyaan tentang kehidupan mereka berdasarkan catatan berikut:
${context}

Gunakan bahasa Indonesia yang casual. Kalau tidak ada info yang relevan, jujur bilang tidak tau.`;

  const messages = [{ role: 'user', content: question }];
  return callGroq(messages, systemPrompt);
};