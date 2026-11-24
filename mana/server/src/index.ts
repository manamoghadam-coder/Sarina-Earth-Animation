import { buildApp } from './app.ts';
import { config } from './config.ts';
import { startScheduler } from './scheduler.ts';
import { startMessengerPolling } from './messenger.ts';

const app = await buildApp();
await app.listen({ port: config.port, host: '0.0.0.0' });
if (config.scheduler) { startScheduler(app.log); startMessengerPolling(app.log); }
else app.log.warn('scheduler disabled');
console.log(`MANA listening on :${config.port}`);
