import dotenv from 'dotenv';

dotenv.config({ quiet: true });

/**
 * All runtime configuration comes from environment variables (see .env.example).
 * Nothing secret is ever hard-coded.
 */
export const config = {
  port: Number(process.env.PORT) || 3000,
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // Postgres connection string. When unset, an embedded Postgres (PGlite)
  // persisted to PGLITE_DIR is used, so local dev needs zero setup.
  databaseUrl: process.env.DATABASE_URL || null,
  pgliteDir: process.env.PGLITE_DIR || './data/pglite',
  // Keep this small on serverless hosts (many instances x pool size).
  poolMax: Number(process.env.PG_POOL_MAX) || 10,
  seedDemoData: process.env.SEED_DEMO_DATA !== 'false',

  // Shared secret Vapi sends in the `x-vapi-secret` header on every webhook.
  vapiWebhookSecret: process.env.VAPI_WEBHOOK_SECRET || null,

  // Optional. When set, /patients requires the `x-api-key` header.
  apiKey: process.env.API_KEY || null,

  clinicName: process.env.CLINIC_NAME || 'Riverside Family Clinic',
  // Name the voice agent introduces itself with (used by setup:vapi).
  agentName: process.env.AGENT_NAME || 'Maya',
  clinicTimezone: process.env.CLINIC_TIMEZONE || 'America/New_York',
};
