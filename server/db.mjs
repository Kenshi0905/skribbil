import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { checkServerIdentity } from 'node:tls';

export function postgresOptions({ url, production = false, caCert } = {}) {
  if (!url) {
    if (production) throw new Error('Production requires an external DATABASE_URL with verified TLS.');
    return null;
  }
  const options = { connectionString: url, max: 12, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 };
  if (!production && !caCert) return options;

  // pg lets connection-string SSL parameters replace the entire ssl object.
  // Validate and remove sslmode before constructing the pool so a provider CA
  // and certificate/hostname verification cannot be silently overridden.
  let parsed;
  try {
    parsed = new URL(url);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.hash ||
        /[/\\\s]/.test(decodeURIComponent(parsed.hostname))) throw new Error();
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL URL with a TCP hostname.');
  }
  for (const [key, value] of parsed.searchParams) {
    if (key === 'sslmode' && value === 'verify-full') continue;
    if (/^ssl/i.test(key) || ['uselibpqcompat', 'host', 'hostaddr'].includes(key.toLowerCase())) {
      throw new Error('DATABASE_URL accepts only sslmode=verify-full; use DATABASE_CA_CERT for a provider CA and the URL hostname for the server.');
    }
  }
  parsed.searchParams.delete('sslmode');
  options.connectionString = parsed.toString();
  options.ssl = { rejectUnauthorized: true, checkServerIdentity, minVersion: 'TLSv1.2' };
  options.sslnegotiation = 'postgres';
  if (caCert !== undefined && caCert !== '') {
    try {
      if (typeof caCert !== 'string' || Buffer.byteLength(caCert) > 65536) throw new Error();
      const certificates = caCert.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
      if (!certificates?.length || caCert.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim()) throw new Error();
      for (const certificate of certificates) new X509Certificate(certificate);
      options.ssl.ca = certificates.join('\n');
    } catch {
      throw new Error('DATABASE_CA_CERT must contain a valid PEM certificate bundle of at most 64 KiB.');
    }
  }
  return options;
}

export async function openDatabase({ url = process.env.DATABASE_URL, dataDir = process.env.DATA_DIR || '.data/postgres',
  production = process.env.NODE_ENV === 'production', caCert = process.env.DATABASE_CA_CERT } = {}) {
  const options = postgresOptions({ url, production, caCert });
  let driver, mode;
  if (options) {
    const { default: pg } = await import('pg');
    driver = new pg.Pool(options);
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
  for (const file of ['community.sql','rematch.sql','clubhouses.sql','session-preferences.sql']) {
    const migration = await readFile(new URL(`../database/${file}`, import.meta.url), 'utf8');
    if (mode === 'postgres') await driver.query(migration); else await driver.exec(migration);
  }
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
