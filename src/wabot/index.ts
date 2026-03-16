import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import P from 'pino'; // <-- Import pino ditambahkan di sini

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const OWNER_NUMBER = process.env.BOT_OWNER_NUMBER || '';
const SESSION_DIR = path.resolve(__dirname, '../../wabot-session');

if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// ─── API Helper ──────────────────────────────────────────
const api = axios.create({ baseURL: BACKEND_URL });

const getUserToken = async (waNumber: string): Promise<string | null> => {
  try {
    const r = await api.get(`/api/wa/token/${waNumber}`);
    return r.data.token;
  } catch {
    return null;
  }
};

// ─── Command Handler ──────────────────────────────────────
const handleMessage = async (
  sock: any,
  jid: string,
  text: string,
  waNumber: string
) => {
  const token = await getUserToken(waNumber);

  if (!token) {
    if (text.startsWith('!link ')) {
      const linkToken = text.replace('!link ', '').trim();
      try {
        await api.post('/api/wa/link', { token: linkToken, waNumber });
        await sock.sendMessage(jid, { text: '✅ Akun berhasil dihubungkan! Sekarang kamu bisa kirim memory via WA.' });
      } catch {
        await sock.sendMessage(jid, { text: '❌ Token tidak valid. Dapatkan token di app → Settings → Link WA.' });
      }
      return;
    }
    await sock.sendMessage(jid, {
      text: '👋 Halo! Untuk menggunakan bot ini, hubungkan akun dulu.\n\nKetik: *!link [token]*\n\nDapatkan token di app → Settings → Link WA.'
    });
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };

  // ─── COMMANDS ────────────────────────────────────────────
  if (text === '!help') {
    await sock.sendMessage(jid, {
      text: `🗂️ *Ambarya Life Archive Bot*\n\n` +
        `📝 *Entry*\n` +
        `• Kirim teks biasa → simpan sebagai entry\n` +
        `• Kirim foto → simpan sebagai photo memory\n\n` +
        `😊 *Mood*\n` +
        `• !mood 1-5 → log mood cepat\n` +
        `• !mood 😊 → log mood pakai emoji\n\n` +
        `💡 *Lainnya*\n` +
        `• !idea [teks] → simpan ide\n` +
        `• !dream [teks] → catat mimpi\n` +
        `• !memory → random memory\n` +
        `• !today → on this day\n` +
        `• !reflect → refleksi hari ini dari AI\n` +
        `• !help → tampilkan bantuan ini`
    });
    return;
  }

  // Mood log
  if (text.startsWith('!mood ')) {
    const moodInput = text.replace('!mood ', '').trim();
    const emojiMap: Record<string, number> = {
      '😊': 5, '😄': 5, '🥰': 5,
      '🙂': 4, '😌': 4,
      '😐': 3, '🤔': 3,
      '😔': 2, '😢': 2, '😞': 2,
      '😰': 1, '😨': 1, '😖': 1,
    };
    const moodLabels: Record<number, string> = {5: 'happy', 4: 'good', 3: 'neutral', 2: 'sad', 1: 'anxious'};

    let moodValue = parseInt(moodInput);
    if (isNaN(moodValue) && emojiMap[moodInput]) moodValue = emojiMap[moodInput];

    if (moodValue >= 1 && moodValue <= 5) {
      await api.post('/api/moods', {
        mood: moodValue,
        mood_label: moodLabels[moodValue],
      }, { headers });
      const emojis = ['', '😰', '😔', '😐', '🙂', '😊'];
      await sock.sendMessage(jid, { text: `${emojis[moodValue]} Mood *${moodLabels[moodValue]}* tercatat!` });
    } else {
      await sock.sendMessage(jid, { text: '❌ Format: !mood 1-5 atau !mood 😊' });
    }
    return;
  }

  // Idea
  if (text.startsWith('!idea ')) {
    const content = text.replace('!idea ', '').trim();
    await api.post('/api/ideas', { content }, { headers });
    await sock.sendMessage(jid, { text: `💡 Ide tersimpan: "${content}"` });
    return;
  }

  // Dream
  if (text.startsWith('!dream ')) {
    const content = text.replace('!dream ', '').trim();
    await api.post('/api/dreams', { content }, { headers });
    await sock.sendMessage(jid, { text: `🌙 Mimpi tercatat: "${content}"` });
    return;
  }

  // Random memory
  if (text === '!memory') {
    try {
      const r = await api.get('/api/entries/random', { headers });
      const entry = r.data.entry;
      const date = new Date(entry.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      await sock.sendMessage(jid, {
        text: `✨ *Random Memory*\n📅 ${date}\n\n*${entry.title || 'Tanpa judul'}*\n\n${(entry.content || '').substring(0, 300)}${(entry.content?.length || 0) > 300 ? '...' : ''}`
      });
    } catch {
      await sock.sendMessage(jid, { text: '😔 Belum ada memory tersimpan.' });
    }
    return;
  }

  // On This Day
  if (text === '!today') {
    try {
      const r = await api.get('/api/entries/on-this-day', { headers });
      const entries = r.data.entries;
      if (entries.length === 0) {
        await sock.sendMessage(jid, { text: '📅 Belum ada memory di tanggal ini dari tahun lalu.' });
        return;
      }
      let msg = `📅 *On This Day*\n\n`;
      for (const e of entries.slice(0, 3)) {
        const date = new Date(e.created_at);
        const yearsAgo = new Date().getFullYear() - date.getFullYear();
        msg += `⏰ *${yearsAgo} tahun lalu*\n*${e.title || 'Tanpa judul'}*\n${(e.content || '').substring(0, 150)}...\n\n`;
      }
      await sock.sendMessage(jid, { text: msg });
    } catch {
      await sock.sendMessage(jid, { text: '❌ Gagal mengambil data.' });
    }
    return;
  }

  // AI Reflection
  if (text === '!reflect') {
    try {
      await sock.sendMessage(jid, { text: '🤖 Sedang generate refleksi...' });
      const r = await api.get('/api/ai/daily-reflection', { headers });
      await sock.sendMessage(jid, { text: `🤖 *Refleksi Hari Ini*\n\n${r.data.reflection}` });
    } catch {
      await sock.sendMessage(jid, { text: '😔 Belum ada entry hari ini untuk direfleksikan.' });
    }
    return;
  }

  // Default: simpan sebagai entry
  await api.post('/api/entries', {
    content: text,
    sync_status: 'synced',
  }, { headers });
  await sock.sendMessage(jid, { text: '✅ Memory tersimpan!' });
};

// ─── Bot Core ─────────────────────────────────────────────
const startBot = async () => {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' }) as any),
    },
    printQRInTerminal: false,
    logger: P({ level: 'silent' }) as any,
  });

  // Pairing code instead of QR
  if (!sock.authState.creds.registered) {
    const phoneNumber = process.env.BOT_PHONE_NUMBER || '';
    if (!phoneNumber) {
      console.log('❌ Set BOT_PHONE_NUMBER di .env (format: 628xxx)');
      process.exit(1);
    }

    // Tunggu sampai baileys benar-benar siap
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
      const code = await sock.requestPairingCode(phoneNumber);
      console.log(`\n📱 Pairing Code untuk nomor ${phoneNumber}:\n`);
      console.log(`   ╔══════════════╗`);
      console.log(`   ║  ${code}  ║`);
      console.log(`   ╚══════════════╝`);
      console.log(`\nBuka WA → Linked Devices → Link with phone number → masukkan kode di atas\n`);
    } catch (err) {
      console.error('❌ Gagal mendapatkan pairing code:', err);
    }
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ WhatsApp Bot connected!');
      if (OWNER_NUMBER) {
        await sock.sendMessage(`${OWNER_NUMBER}@s.whatsapp.net`, {
          text: '🚀 Ambarya Life Archive Bot aktif!\n\nKetik *!help* untuk melihat semua command.'
        });
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const jid = msg.key.remoteJid!;
      const text = msg.message.conversation ||
        msg.message.extendedTextMessage?.text || '';
      if (!text) continue;

      const waNumber = jid.replace('@s.whatsapp.net', '');
      console.log(`📨 Message from ${waNumber}: ${text}`);

      try {
        await handleMessage(sock, jid, text, waNumber);
      } catch (err) {
        console.error('Error handling message:', err);
      }
    }
  });
};

startBot().catch(console.error);