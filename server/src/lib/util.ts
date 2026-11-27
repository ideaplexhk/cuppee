import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

export const now = () => Date.now();

export function id(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function token(): string {
  return randomBytes(32).toString('base64url');
}

export function sixDigits(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashPin(pin: string, salt = randomBytes(8).toString('hex')): string {
  return `${salt}:${scryptSync(pin, salt, 32).toString('hex')}`;
}

export function checkPin(pin: string, stored: string): boolean {
  const [salt, hex] = stored.split(':');
  const a = Buffer.from(hex, 'hex');
  const b = scryptSync(pin, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hmac(secret: string, msg: string): string {
  return createHmac('sha256', secret).update(msg).digest('base64url');
}

export function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Normalise Hong Kong numbers to E.164. Accepts 8-digit local numbers or +852… */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, '');
  if (/^[4-9]\d{7}$/.test(digits)) return `+852${digits}`;
  if (/^\+852[4-9]\d{7}$/.test(digits)) return digits;
  if (/^\+[1-9]\d{6,14}$/.test(digits)) return digits; // other countries, pass through
  return null;
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}
