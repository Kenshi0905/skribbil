import { scrypt, randomBytes, createHash, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
// Keep expensive password work bounded on the free single-instance host.
let passwordWorkers=0;
const passwordQueue=[];
async function derivePassword(password,salt){
  if(passwordWorkers<2)passwordWorkers++;
  else {requireValue(passwordQueue.length<16,'Sign-in is busy. Try again shortly.',429);await new Promise(resolve=>passwordQueue.push(resolve));}
  try{return await derive(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});}
  finally{const next=passwordQueue.shift();if(next)next();else passwordWorkers--;}
}
export const hash = value => createHash('sha256').update(value).digest('hex');
export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derivePassword(password, salt);
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password, stored) {
  const [kind, salt, expected] = (stored || '').split(':');
  if (kind !== 'scrypt' || !expected) return false;
  const key = await derivePassword(password, salt);
  const bytes = Buffer.from(expected, 'hex');
  return bytes.length === key.length && timingSafeEqual(bytes, key);
}
export function newSession() { const token = randomBytes(32).toString('base64url'); return { token, tokenHash: hash(token) }; }
export function signedTicket(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}
export function readTicket(token,secret) {
  requireValue(typeof token==='string'&&token.length<=8192,'Invalid game admission.',403);
  const [encoded,signature,extra]=token.split('.');
  const expected=createHmac('sha256',secret).update(encoded||'').digest('base64url');
  requireValue(!extra&&/^[A-Za-z0-9_-]{43}$/.test(signature||'')&&timingSafeEqual(Buffer.from(signature),Buffer.from(expected)),'Invalid game admission.',403);
  let data;try{data=JSON.parse(Buffer.from(encoded,'base64url').toString());}catch{throw new ApiError(403,'Invalid game admission.');}
  requireValue(data&&isUuid(data.userId)&&isUuid(data.matchId)&&typeof data.lobbyId==='string'&&Number.isInteger(data.expiresAt)&&data.expiresAt>Math.floor(Date.now()/1000),'Game admission expired. Rejoin from Skribbil.',403);
  return data;
}
export function verifySignature(raw, signature, secret) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature || '')) return false;
  return timingSafeEqual(createHmac('sha256', secret).update(raw).digest(), Buffer.from(signature, 'hex'));
}
export function sessionToken(req) {
  return (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('skribbil_session='))?.slice(17);
}
export function setSession(res, token, secure = false, rememberMe = false) {
  res.setHeader('Set-Cookie', `skribbil_session=${token}; Path=/; HttpOnly; SameSite=Lax${!token ? '; Max-Age=0' : rememberMe ? '; Max-Age=604800' : ''}${secure ? '; Secure' : ''}`);
}
export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function requireValue(condition, message, status = 400) { if (!condition) throw new ApiError(status, message); }
export const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function textField(value, min, max, label) {
  requireValue(typeof value === 'string' && value.trim().length >= min && value.trim().length <= max, `${label} must be ${min}–${max} characters.`);
  return value.trim();
}
