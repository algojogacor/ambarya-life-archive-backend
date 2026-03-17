import { google } from 'googleapis';
import { Readable } from 'stream';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

let credentials;

try {
  // 1. Coba baca dari file path lokal terlebih dahulu
  if (process.env.GDRIVE_KEY_PATH && fs.existsSync(process.env.GDRIVE_KEY_PATH)) {
    credentials = JSON.parse(fs.readFileSync(process.env.GDRIVE_KEY_PATH, 'utf-8'));
  } 
  // 2. Kalau path tidak ada (misal di Koyeb), baru baca dari Base64
  else if (process.env.GDRIVE_KEY_BASE64) {
    credentials = JSON.parse(
      Buffer.from(process.env.GDRIVE_KEY_BASE64, 'base64').toString('utf-8')
    );
  } else {
    throw new Error("Kredensial Google Drive tidak ditemukan di .env!");
  }
} catch (error) {
  console.error("Gagal membaca kredensial GDrive:", error);
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });

const FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '';

export const uploadFile = async (
  buffer: Buffer,
  filename: string,
  mimeType: string,
  subfolder?: string
): Promise<{ fileId: string; webViewLink: string }> => {
  let parentId = FOLDER_ID;

  // Buat subfolder kalau belum ada (misal: "photos", "voices")
  if (subfolder) {
    const existing = await drive.files.list({
      q: `name='${subfolder}' and '${FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
      // Tambahkan ini agar bisa membaca folder yang dibagikan
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (existing.data.files && existing.data.files.length > 0) {
      parentId = existing.data.files[0].id!;
    } else {
      const folder = await drive.files.create({
        requestBody: {
          name: subfolder,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [FOLDER_ID],
        },
        fields: 'id',
        supportsAllDrives: true, // Tambahkan ini
      });
      parentId = folder.data.id!;
    }
  }

  const stream = Readable.from(buffer);

  const response = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [parentId],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: 'id, webViewLink',
    supportsAllDrives: true, // Tambahkan ini
  });

  // Set file readable by anyone with link
  await drive.permissions.create({
    fileId: response.data.id!,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
    supportsAllDrives: true, // Tambahkan ini
  });

  return {
    fileId: response.data.id!,
    webViewLink: response.data.webViewLink!,
  };
};

export const deleteFile = async (fileId: string): Promise<void> => {
  await drive.files.delete({ 
    fileId,
    supportsAllDrives: true, // Tambahkan ini
  });
};

export const getFileStream = async (fileId: string) => {
  const response = await drive.files.get(
    { 
      fileId, 
      alt: 'media',
      supportsAllDrives: true, // Tambahkan ini
    },
    { responseType: 'stream' }
  );
  return response.data;
};