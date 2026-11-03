import { buildApp } from './app.js';
import { startBackupScheduler } from './services/backup.js';

const app = await buildApp();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

if (process.env.NODE_ENV !== 'test' && process.env.BACKUP_DISABLED !== 'true') {
  startBackupScheduler();
}

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
