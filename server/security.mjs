import { scrypt, randomBytes, createHash, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const hash = value => createHash('sha256').update(value).digest('hex');
export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password, stored) {
  const [kind, salt, expected] = (stored || '').split(':');
  if (kind !== 'scrypt' || !expected) return false;
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const bytes = Buffer.from(expected, 'hex');
  return bytes.length === key.length && timingSafeEqual(bytes, key);
}
export function newSession() { const token = randomBytes(32).toString('base64url'); return { token, tokenHash: hash(token) }; }
export function signedTicket(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}
export function verifySignature(raw, signature, secret) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature || '')) return false;
  return timingSafeEqual(createHmac('sha256', secret).update(raw).digest(), Buffer.from(signature, 'hex'));
}
export function sessionToken(req) {
  return (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('skribbil_session='))?.slice(17);
}
export function setSession(res, token, secure = false) {
  res.setHeader('Set-Cookie', `skribbil_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 604800 : 0}${secure ? '; Secure' : ''}`);
}
export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function requireValue(condition, message, status = 400) { if (!condition) throw new ApiError(status, message); }
export const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function textField(value, min, max, label) {
  requireValue(typeof value === 'string' && value.trim().length >= min && value.trim().length <= max, `${label} must be ${min}–${max} characters.`);
  return value.trim();
}
