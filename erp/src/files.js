// ذخیره‌ی فایل‌های پیوست روی دیسک (مسیر: <data>/files/<companyId>/<uuid>)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let DIR = null;
export function setFilesDir(d) { DIR = path.resolve(d); fs.mkdirSync(DIR, { recursive: true }); }

export function saveFile(companyId, buf) {
  const rel = `${Number(companyId)}/${crypto.randomUUID()}`;
  const abs = path.join(DIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf, { mode: 0o600 });
  return rel;
}
export function filePath(stored) {
  const abs = path.resolve(DIR, stored);
  if (!abs.startsWith(DIR + path.sep)) throw new Error('مسیر نامعتبر');
  return abs;
}
export function deleteFile(stored) { try { fs.unlinkSync(filePath(stored)); } catch { /* ignore */ } }

// فقط این پسوندها پذیرفته می‌شوند؛ دانلود همیشه به‌صورت attachment است
export const ALLOWED = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint',
  txt: 'text/plain', zip: 'application/zip', dwg: 'application/octet-stream', dxf: 'application/octet-stream',
};
