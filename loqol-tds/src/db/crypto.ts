/**
 * Password and token handling. Everything here is node:crypto — no bcrypt or
 * argon2 native build to fight with.
 */

import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const KEY_LEN = 64;

/**
 * Agent passwords. Human-chosen and therefore guessable, so they need a slow
 * KDF. scrypt is one, and it ships with Node.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, "hex");
  if (expected.length !== KEY_LEN) return false;

  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), KEY_LEN);
  return timingSafeEqual(expected, actual);
}

/**
 * The seller's magic-link token. 256 bits from the CSPRNG, handed out once and
 * never stored in plaintext.
 */
export function mintSellerToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * ponytail: plain SHA-256, not a KDF — and that is the correct choice here
 * rather than a shortcut. A KDF exists to make guessing a low-entropy secret
 * expensive. This token is 256 random bits; there is nothing to guess, so all
 * scrypt would buy is latency on every seller page load. Hashing at all is
 * what matters: a leaked database must not yield working magic links.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
