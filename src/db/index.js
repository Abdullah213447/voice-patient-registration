import { mkdir, readFile } from 'node:fs/promises';
import { logger } from '../logger.js';

const DATE_OID = 1082;

/**
 * Opens the database and returns a tiny client with the same shape for both
 * engines: `query(text, params) -> { rows }`, `exec(sql)`, `close()`.
 *
 * - DATABASE_URL set  -> real PostgreSQL via node-postgres (production).
 * - otherwise         -> PGlite, an embedded WASM build of Postgres persisted to
 *                        disk (or memory for tests). Same SQL, same constraints.
 */
export async function openDatabase({ databaseUrl, pgliteDir }) {
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    // Keep DATE columns as 'YYYY-MM-DD' strings; JS Date would shift by timezone.
    pg.types.setTypeParser(DATE_OID, (v) => v);
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    pool.on('error', (err) => logger.error({ err }, 'postgres pool error'));
    return {
      kind: 'postgres',
      query: (text, params) => pool.query(text, params),
      exec: (sql) => pool.query(sql),
      close: () => pool.end(),
    };
  }

  const { PGlite, types } = await import('@electric-sql/pglite');
  const inMemory = !pgliteDir || pgliteDir === ':memory:';
  if (!inMemory) await mkdir(pgliteDir, { recursive: true });
  const db = new PGlite({
    ...(inMemory ? {} : { dataDir: pgliteDir }),
    parsers: { [types.DATE]: (v) => v },
  });
  await db.waitReady;
  return {
    kind: inMemory ? 'pglite-memory' : 'pglite',
    query: (text, params) => db.query(text, params),
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
  };
}

export async function migrate(db) {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.exec(sql);
}
