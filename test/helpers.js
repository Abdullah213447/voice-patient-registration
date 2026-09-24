import { openDatabase, migrate } from '../src/db/index.js';
import { createApp } from '../src/app.js';

export const baseConfig = {
  clinicTimezone: 'America/New_York',
  apiKey: null,
  vapiWebhookSecret: 'test-secret',
};

/** Fresh app backed by an in-memory Postgres (PGlite) per test file. */
export async function createTestApp(overrides = {}) {
  const db = await openDatabase({ databaseUrl: null, pgliteDir: ':memory:' });
  await migrate(db);
  const app = createApp({ db, config: { ...baseConfig, ...overrides } });
  return { app, db };
}

export const validPatient = () => ({
  first_name: 'Maria',
  last_name: "O'Connor-Davis",
  date_of_birth: '07/04/1990',
  sex: 'Female',
  phone_number: '(512) 555-0100',
  email: 'Maria@Example.com',
  address_line_1: '500 Congress Ave',
  address_line_2: 'Suite 200',
  city: 'Austin',
  state: 'tx',
  zip_code: '78701',
});
