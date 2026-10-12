import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { rootCertificates, checkServerIdentity } from 'node:tls';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { postgresOptions, openDatabase } from '../server/db.mjs';

const url = 'postgresql://fixture@database.example.test:5432/skribbil';
const certificate = rootCertificates[0];

test('production TLS survives installed pg connection-string parsing and verifies hostnames', () => {
  for (const suffix of ['', '?sslmode=verify-full&application_name=skribbil']) {
    const options = postgresOptions({ url: url + suffix, production: true });
    const actual = new pg.Client(options).connectionParameters;
    assert.equal(actual.ssl.rejectUnauthorized, true);
    assert.equal(actual.ssl.minVersion, 'TLSv1.2');
    assert.equal(actual.ssl.checkServerIdentity, checkServerIdentity);
    assert.equal(actual.host, 'database.example.test');
    assert.equal(actual.isDomainSocket, false);
    assert.equal(actual.sslnegotiation, 'postgres');
    assert.equal(new URL(options.connectionString).searchParams.has('sslmode'), false);
    assert.equal(actual.ssl.checkServerIdentity('database.example.test', { subjectaltname: 'DNS:database.example.test' }), undefined);
    assert.equal(actual.ssl.checkServerIdentity('other.example.test', { subjectaltname: 'DNS:database.example.test' }).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  }
});

test('production refuses SSL downgrades, URL certificate paths, socket overrides and malformed URLs without echoing credentials', () => {
  const credential = randomBytes(24).toString('base64url');
  const privateUrl = url.replace('fixture@', 'fixture:' + credential + '@');
  for (const suffix of ['?sslmode=disable', '?sslmode=require', '?sslmode=prefer', '?sslmode=verify-ca', '?sslmode=no-verify',
    '?sslmode=verify-full&sslmode=disable', '?ssl=0', '?ssl=no-verify', '?sslrootcert=/missing.pem', '?sslkey=/missing.key',
    '?sslcert=/missing.pem', '?uselibpqcompat=true', '?host=%2Ftmp', '?hostaddr=127.0.0.1', '?sslnegotiation=direct']) {
    assert.throws(() => postgresOptions({ url: privateUrl + suffix, production: true }), error => {
      assert.match(error.message, /DATABASE_URL/);
      assert.equal(error.message.includes(credential), false);
      assert.equal(error.message.includes(privateUrl), false);
      return true;
    });
  }
  for (const invalid of ['socket:/tmp/db', 'postgresql:///db', 'postgresql://%2Ftmp/db', 'https://database.example.test/db', privateUrl + '#fragment', 'invalid:' + credential]) {
    assert.throws(() => postgresOptions({ url: invalid, production: true }), error => {
      assert.equal(error.message, 'DATABASE_URL must be a PostgreSQL URL with a TCP hostname.');
      return true;
    });
  }
});

test('runtime provider CA remains attached after pg parses verify-full and can opt development into verified TLS', () => {
  for (const production of [true, false]) {
    const options = postgresOptions({ url: url + '?sslmode=verify-full', production, caCert: certificate });
    const actual = new pg.Client(options).connectionParameters.ssl;
    assert.equal(actual.ca, certificate.trim());
    assert.equal(actual.rejectUnauthorized, true);
    assert.equal(actual.checkServerIdentity, checkServerIdentity);
  }
  const bundle = certificate + '\n' + rootCertificates[1];
  assert.equal(postgresOptions({ url, production: true, caCert: bundle }).ssl.ca.match(/BEGIN CERTIFICATE/g).length, 2);
});

test('invalid or oversized CA configuration fails closed without printing its contents', () => {
  const privateValue = randomBytes(24).toString('base64url');
  for (const caCert of [privateValue, ' ', certificate + privateValue, '-----BEGIN CERTIFICATE-----\n' + privateValue + '\n-----END CERTIFICATE-----', 'x'.repeat(65537)]) {
    assert.throws(() => postgresOptions({ url, production: true, caCert }), error => {
      assert.equal(error.message, 'DATABASE_CA_CERT must contain a valid PEM certificate bundle of at most 64 KiB.');
      assert.equal(error.message.includes(privateValue), false);
      return true;
    });
  }
});

test('production startup validates TLS before connecting and ignores PGSSLMODE downgrade', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skribbil-tls-config-'));
  try {
    // Separate cwd and an explicit environment prevent loading repository .env
    // or local credentials. No database or provider connection is attempted.
    const env = {
      SystemRoot: process.env.SystemRoot || '', PATH: process.env.PATH || '',
      NODE_ENV: 'production', DATABASE_URL: url + '?sslmode=verify-full', DATABASE_CA_CERT: certificate,
      S3_BUCKET: 'skribbil-test', COOKIE_SECURE: 'true', PUBLIC_ORIGIN: 'https://fixture.pages.dev',
      SKRIBBIL_ENGINE_SECRET: randomBytes(32).toString('hex'), SKRIBBIL_ORIGIN_KEY: randomBytes(32).toString('hex'),
      PGSSLMODE: 'no-verify',
    };
    const code = `const {loadConfig}=await import(${JSON.stringify(new URL('../server/config.mjs', import.meta.url).href)});
      const {postgresOptions}=await import(${JSON.stringify(new URL('../server/db.mjs', import.meta.url).href)});
      const {default:pg}=await import(${JSON.stringify(new URL('../node_modules/pg/lib/index.js', import.meta.url).href)});
      await loadConfig();
      const actual=new pg.Client(postgresOptions({url:process.env.DATABASE_URL,production:true,caCert:process.env.DATABASE_CA_CERT})).connectionParameters;
      if(actual.ssl.rejectUnauthorized!==true||typeof actual.ssl.checkServerIdentity!=='function')throw Error('TLS was downgraded');
      process.env.DATABASE_URL+='&ssl=0';
      try {await loadConfig();process.exitCode=1;} catch(error) {if(!error.message.startsWith('DATABASE_URL'))throw error;}
      process.stdout.write('verified');`;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: directory, env, encoding: 'utf8', timeout: 15000, maxBuffer: 65536, windowsHide: true });
    assert.equal(output, 'verified');
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('skribbil-tls-config-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('production cannot silently fall back to an embedded database', async () => {
  assert.throws(() => postgresOptions({ url: '', production: true }), /external DATABASE_URL with verified TLS/);
  await assert.rejects(openDatabase({ url: '', dataDir: ':memory:', production: true, caCert: '' }), /external DATABASE_URL with verified TLS/);
});

test('local PGlite and explicitly configured development PostgreSQL retain their existing behavior', async () => {
  assert.equal(postgresOptions({ url: '', production: false }), null);
  assert.equal(postgresOptions({ url: url + '?sslmode=disable', production: false }).ssl, undefined);
  const db = await openDatabase({ url: '', dataDir: ':memory:', production: false, caCert: '' });
  try {
    assert.equal(db.mode, 'embedded-postgres');
    assert.equal((await db.query('SELECT 1 AS value')).rows[0].value, 1);
  } finally { await db.close(); }
});
