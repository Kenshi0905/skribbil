import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function openDatabase({ url = process.env.DATABASE_URL, dataDir = process.env.DATA_DIR || '.data/postgres' } = {}) {
  let driver, mode;
  if (url) {
    const { default: pg } = await import('pg');
    driver = new pg.Pool({ connectionString: url, max: 12 });
    mode = 'postgres';
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    if (dataDir !== ':memory:') await mkdir(resolve(dataDir), { recursive: true });
    driver = new PGlite(dataDir === ':memory:' ? undefined : resolve(dataDir));
    await driver.waitReady;
    mode = 'embedded-postgres';
  }
  const query = (sql, values = []) => driver.query(sql, values);
  const present = await query("SELECT to_regclass('skribbil.users') AS name");
  if (!present.rows[0].name) {
    const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
    if (mode === 'postgres') await driver.query(schema); else await driver.exec(schema);
  }
  const seed = await readFile(new URL('../database/seed.sql', import.meta.url), 'utf8');
  if (mode === 'postgres') await driver.query(seed); else await driver.exec(seed);
  const runtime = await readFile(new URL('../database/runtime.sql', import.meta.url), 'utf8');
  if (mode === 'postgres') await driver.query(runtime); else await driver.exec(runtime);
  // Every query uses explicit schema qualification: pool connections need no mutable search_path.
  let tail = Promise.resolve();
  const transaction = async (fn) => {
    if (mode === 'postgres') {
      const client = await driver.connect();
      try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    // PGlite's transaction() prevents unrelated queries from interleaving with a transaction.
    const run = tail.then(() => driver.transaction(fn));
    tail = run.catch(() => {});
    return run;
  };
  return { query, transaction, mode, close: () => mode === 'postgres' ? driver.end() : driver.close() };
}
