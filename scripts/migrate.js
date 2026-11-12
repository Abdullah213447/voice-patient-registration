#!/usr/bin/env node
/**
 * Applies src/db/schema.sql (idempotent) and seeds the demo patients if the
 * table is empty. Used for serverless hosting, where the app does not migrate
 * on boot.
 *
 * Usage: DATABASE_URL=postgres://... npm run db:migrate
 */
import { config } from '../src/config.js';
import { openDatabase, migrate } from '../src/db/index.js';
import { seedIfEmpty } from '../src/db/seed.js';

if (!config.databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const db = await openDatabase(config);
await migrate(db);
if (config.seedDemoData) await seedIfEmpty(db);
const { rows } = await db.query('SELECT count(*)::int AS n FROM patients WHERE deleted_at IS NULL');
console.log(`Schema up to date; ${rows[0].n} active patients.`);
await db.close();
