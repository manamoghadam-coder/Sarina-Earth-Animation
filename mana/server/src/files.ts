import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.ts';

export const storeDir = (sub: string) => { const d = path.resolve(config.storageDir, sub); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
export type Kind = { kind: 'pdf' | 'audio' | 'photo' | 'video'; mime: string; ext: string };

/** Identify a file by its first bytes (never trust the client's content-type or file name). */
export function sniffFile(h: Buffer): Kind | null {
  if (h.subarray(0, 5).toString() === '%PDF-') return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' };
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { kind: 'photo', mime: 'image/jpeg', ext: 'jpg' };
  if (h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'photo', mime: 'image/png', ext: 'png' };
  if (h.subarray(0, 4).toString() === 'RIFF' && h.subarray(8, 12).toString() === 'WEBP') return { kind: 'photo', mime: 'image/webp', ext: 'webp' };
  if (h.subarray(0, 4).toString() === 'RIFF' && h.subarray(8, 12).toString() === 'WAVE') return { kind: 'audio', mime: 'audio/wav', ext: 'wav' };
  if (h.subarray(0, 4).toString() === 'OggS') return { kind: 'audio', mime: 'audio/ogg', ext: 'ogg' };
  if (h.subarray(0, 3).toString() === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg', ext: 'mp3' };
  if (h.subarray(4, 8).toString() === 'ftyp') { const brand = h.subarray(8, 12).toString(); return /^(M4A|M4B)/.test(brand) ? { kind: 'audio', mime: 'audio/mp4', ext: 'm4a' } : { kind: 'video', mime: 'video/mp4', ext: 'mp4' }; }
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return { kind: 'video', mime: 'video/webm', ext: 'webm' };
  return null;
}

/** Streams an upload to disk (no big buffers). Returns null when it exceeds maxBytes or its type is not allowed. */
export async function saveUpload(file: { file: NodeJS.ReadableStream & { truncated?: boolean } }, sub: string, allowed: Kind['kind'][], maxBytes: number): Promise<{ name: string; kind: Kind; bytes: number } | { error: 'too_large' | 'unsupported_type' }> {
  const dir = storeDir(sub); const tmp = path.join(dir, `.upload-${crypto.randomUUID()}`);
  await pipeline(file.file, fs.createWriteStream(tmp, { mode: 0o600 }));
  const bytes = fs.statSync(tmp).size;
  if ((file.file as any).truncated || bytes > maxBytes) { fs.rmSync(tmp, { force: true }); return { error: 'too_large' }; }
  const fd = fs.openSync(tmp, 'r'); const head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
  const kind = sniffFile(head);
  if (!kind || !allowed.includes(kind.kind)) { fs.rmSync(tmp, { force: true }); return { error: 'unsupported_type' }; }
  const name = `${crypto.randomUUID()}.${kind.ext}`; fs.renameSync(tmp, path.join(dir, name));
  return { name, kind, bytes };
}

/** Serves a stored file with HTTP Range support (audio/video seeking, large PDFs). */
export function sendStored(req: FastifyRequest, reply: FastifyReply, sub: string, fileName: string, mime: string, download = false) {
  const p = path.join(storeDir(sub), path.basename(fileName));
  if (!fs.existsSync(p)) return reply.code(404).send({ error: 'file_missing' });
  const size = fs.statSync(p).size; const range = req.headers.range;
  reply.header('Content-Type', mime).header('Accept-Ranges', 'bytes').header('Cache-Control', 'private, max-age=300').header('Content-Disposition', download ? 'attachment' : 'inline');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]); let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    if (!m[1]) end = size - 1; end = Math.min(end, size - 1);
    if (start < 0 || start > end || start >= size) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1).send(fs.createReadStream(p, { start, end }));
  }
  return reply.header('Content-Length', size).send(fs.createReadStream(p));
}
export const removeStored = (sub: string, fileName: string) => fs.rmSync(path.join(storeDir(sub), path.basename(fileName)), { force: true });
