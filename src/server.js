import { config } from './config.js';
import { logger } from './logger.js';
import { openDatabase, migrate } from './db/index.js';
import { seedIfEmpty } from './db/seed.js';
import { createApp } from './app.js';

const db = await openDatabase(config);
await migrate(db);
if (config.seedDemoData) await seedIfEmpty(db);

const server = createApp({ db, config }).listen(config.port, () => {
  logger.info({ port: config.port, database: db.kind }, 'server listening');
});

// Graceful shutdown so PGlite flushes to disk and in-flight requests finish.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
