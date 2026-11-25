import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { ZodError } from 'zod';
import { config } from './config.ts';
import authRoutes from './routes/auth.ts';
import parentRoutes from './routes/parent.ts';
import familyRoutes from './routes/family.ts';
import photoRoutes from './routes/photos.ts';
import notificationRoutes from './routes/notifications.ts';
import aiRoutes from './routes/ai.ts';
import kidsRoutes from './routes/kids.ts';
import learnRoutes from './routes/learn.ts';
import libraryRoutes from './routes/library.ts';
import kidAiRoutes from './routes/kidai.ts';
import adminRoutes from './routes/admin.ts';
import messengerRoutes from './routes/messenger.ts';
import extraRoutes from './routes/extras.ts';

export async function buildApp() {
  const app = Fastify({ logger: config.prod ? { level: 'info' } : { level: 'warn' }, bodyLimit: 1_000_000, trustProxy: config.prod });
  await app.register(helmet, { contentSecurityPolicy: { directives: { upgradeInsecureRequests: config.prod ? [] : null, defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'"], mediaSrc: ["'self'", 'blob:'], workerSrc: ["'self'"] } } });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(multipart);
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'validation', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (err.code === '23514' || err.code === '22P02' || err.code === '23503' || err.code === '23505') return reply.code(400).send({ error: 'invalid_data' });
    if (err.code === '42501') return reply.code(403).send({ error: 'forbidden' });          // RLS violation
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request' });
    req.log.error(err); return reply.code(500).send({ error: 'server_error' });
  });
  app.get('/api/health', async () => ({ ok: true, version: '5' }));
  for (const r of [authRoutes, parentRoutes, familyRoutes, photoRoutes, notificationRoutes, aiRoutes, kidsRoutes, learnRoutes, libraryRoutes, kidAiRoutes, adminRoutes, messengerRoutes, extraRoutes]) await app.register(r);

  const dist = path.resolve(import.meta.dirname, '../../web/dist');
  if (fs.existsSync(dist)) {
    await app.register(fstatic, { root: dist });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not_found' }) : reply.sendFile('index.html')));
  }
  return app;
}
