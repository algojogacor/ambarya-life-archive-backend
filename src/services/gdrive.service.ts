import { google } from 'googleapis';
import { Readable } from 'stream';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const auth = new google.auth.GoogleAuth({
  keyFile: path.resolve(process.env.GDRIVE_KEY_PATH || ''),
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
  });

  // Set file readable by anyone with link
  await drive.permissions.create({
    fileId: response.data.id!,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  return {
    fileId: response.data.id!,
    webViewLink: response.data.webViewLink!,
  };
};

export const deleteFile = async (fileId: string): Promise<void> => {
  await drive.files.delete({ fileId });
};

export const getFileStream = async (fileId: string) => {
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  return response.data;
};