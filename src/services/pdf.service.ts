import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

interface Entry {
  title?: string;
  content?: string;
  mood_label?: string;
  location_text?: string;
  tags?: string[];
  created_at: string;
}

export const generateLifeAlbumPDF = (
  entries: Entry[],
  meta: { name: string; period: string }
): PassThrough => {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const stream = new PassThrough();
  doc.pipe(stream);

  // Cover page
  doc.fontSize(28).font('Helvetica-Bold').text("Ambarya's Life Archive", { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(16).font('Helvetica').text(meta.period, { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor('#888').text(`${entries.length} memories`, { align: 'center' });
  doc.addPage();

  // Entries
  entries.forEach((entry, i) => {
    const date = new Date(entry.created_at).toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    doc.fillColor('#333').fontSize(10).text(date, { align: 'right' });
    doc.moveDown(0.3);

    if (entry.title) {
      doc.fillColor('#111').fontSize(18).font('Helvetica-Bold').text(entry.title);
      doc.moveDown(0.3);
    }

    if (entry.mood_label) {
      doc.fillColor('#666').fontSize(10).font('Helvetica').text(`Mood: ${entry.mood_label}`);
      doc.moveDown(0.2);
    }

    if (entry.location_text) {
      doc.fillColor('#666').fontSize(10).text(`📍 ${entry.location_text}`);
      doc.moveDown(0.2);
    }

    if (entry.content) {
      doc.fillColor('#222').fontSize(12).font('Helvetica').text(entry.content, { align: 'justify' });
      doc.moveDown(0.5);
    }

    if (entry.tags && entry.tags.length > 0) {
      doc.fillColor('#999').fontSize(9).text(`#${entry.tags.join('  #')}`);
    }

    // Divider (kecuali entry terakhir)
    if (i < entries.length - 1) {
      doc.moveDown(1);
      doc.strokeColor('#ddd').lineWidth(0.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(1);

      // New page setiap 3 entries
      if ((i + 1) % 3 === 0) doc.addPage();
    }
  });

  doc.end();
  return stream;
};