/**
 * Plugin-side AES-256-GCM helpers.
 *
 * Mirrors `EchoMem-Chrome/utils/crypto.ts` byte-for-byte so that anything
 * encrypted here can be read by the Chrome extension and vice versa. Same
 * algorithm (AES-256-GCM), same KDF (PBKDF2-SHA-256, 600k iterations),
 * same wire format (base64 of 12-byte IV || ciphertext || 16-byte auth tag).
 *
 * Runs on Node 18+ via globalThis.crypto.subtle. No external deps.
 */

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const DEFAULT_ITERATIONS = 600_000;
const VERIFICATION_PLAINTEXT = "echomem-verify-v1";
const LEGACY_VERIFICATION_PLAINTEXT = "echo-vault-verify";

const subtle = globalThis.crypto.subtle;

function toBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function generateSalt() {
  return globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

export function saltToBase64(salt) {
  return toBase64(salt);
}

export function saltFromBase64(b64) {
  return fromBase64(b64);
}

export async function deriveKey(passphrase, salt, iterations = DEFAULT_ITERATIONS) {
  const encoder = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const saltBuf = new Uint8Array(salt).buffer;
  return subtle.deriveKey(
    { name: "PBKDF2", salt: saltBuf, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function exportKeyToBase64(key) {
  const raw = await subtle.exportKey("raw", key);
  return toBase64(raw);
}

export async function importKeyFromBase64(b64) {
  const raw = fromBase64(b64);
  const keyBuf = new Uint8Array(raw).buffer;
  return subtle.importKey(
    "raw",
    keyBuf,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(plaintext, key) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoder = new TextEncoder();
  const ciphertext = await subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(plaintext),
  );
  const combined = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_BYTES);
  return toBase64(combined);
}

export async function decrypt(ciphertext, key) {
  const combined = fromBase64(ciphertext);
  const iv = combined.slice(0, IV_BYTES);
  const data = combined.slice(IV_BYTES);
  const plainBuffer = await subtle.decrypt({ name: ALGORITHM, iv }, key, data);
  return new TextDecoder().decode(plainBuffer);
}

export async function createVerification(key) {
  return encrypt(VERIFICATION_PLAINTEXT, key);
}

export async function verifyKey(key, token) {
  try {
    const result = await decrypt(token, key);
    return result === VERIFICATION_PLAINTEXT || result === LEGACY_VERIFICATION_PLAINTEXT;
  } catch {
    return false;
  }
}

/**
 * Try to decrypt a single field; on any error (wrong key, malformed
 * ciphertext, legacy plaintext that happened to look base64-y) return the
 * original value unchanged. Used for read-time decryption of memory
 * fields where we want to be permissive — the database is mixed (encrypted
 * + legacy plaintext) for accounts that turned on E2EE later.
 */
export async function tryDecrypt(value, key) {
  if (!value || typeof value !== "string" || !key) return value;
  try {
    return await decrypt(value, key);
  } catch {
    return value;
  }
}

/**
 * Decrypt the encrypted body fields of a memory row. Returns a new object;
 * the input is not mutated. Only acts when `is_encrypted: true` and a key is
 * provided. `keys` (title) is always passed through — current schema never
 * encrypts the title (this is the leak the audit flagged separately).
 */
export async function decryptMemoryRow(memory, key) {
  if (!memory || typeof memory !== "object") return memory;
  if (!memory.is_encrypted || !key) return memory;
  const next = { ...memory };
  next.description = await tryDecrypt(memory.description, key);
  next.details = await tryDecrypt(memory.details, key);
  return next;
}

/** Decrypt source_of_truth.content if encrypted. */
export async function decryptSourceRow(source, key) {
  if (!source || typeof source !== "object") return source;
  if (!source.is_encrypted || !key) return source;
  const next = { ...source };
  next.content = await tryDecrypt(source.content, key);
  return next;
}
