export const config = {
  port: Number(process.env.PORT ?? 8080),
  prod: process.env.NODE_ENV === 'production',
  dbUrl: process.env.DATABASE_URL ?? '',
  dbOwnerUrl: process.env.DATABASE_URL_OWNER ?? '',
  storageDir: process.env.STORAGE_DIR ?? './storage',
  vapidPublic: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivate: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicBase: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
  scheduler: (process.env.SCHEDULER ?? 'on') === 'on',
  tz: 'Asia/Tehran',
  sessionDays: 14,
};
if (!config.dbUrl || !config.dbOwnerUrl) throw new Error('DATABASE_URL and DATABASE_URL_OWNER are required');
