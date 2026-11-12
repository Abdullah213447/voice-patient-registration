import { config } from './config.js';
import { openDatabase } from './db/index.js';
import { createApp } from './app.js';

/**
 * Vercel entry point: the same Express app as src/server.js, exported instead
 * of listening. Opening the pg pool does not connect, so this never fails at
 * load time.
 *
 * The schema is NOT migrated here: concurrent cold starts (e.g. several tool
 * calls at once) would race on CREATE OR REPLACE FUNCTION. Run
 * `npm run db:migrate` against DATABASE_URL after a schema change instead.
 */
const db = await openDatabase(config);
export default createApp({ db, config });
