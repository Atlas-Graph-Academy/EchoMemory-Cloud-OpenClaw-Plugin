const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_BYTES = 12;
const SALT_BYTES = 16;
export const DEFAULT_ITERATIONS = 600000;
const VERIFICATION_PLAINTEXT = 'echomem-verify-v1';
const LEGACY_VERIFICATION_PLAINTEXT = 'echo-vault-verify';

function toBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function generateSalt() {
  return globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

async function deriveKey(passphrase, salt, iterations = DEFAULT_ITERATIONS) {
  const encoder = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const saltBuffer = new Uint8Array(salt).buffer;
  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuffer, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt'],
  );
}

async function exportKeyToBase64(key) {
  const raw = await globalThis.crypto.subtle.exportKey('raw', key);
  return toBase64(raw);
}

async function encrypt(plaintext, key) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_BYTES);
  return toBase64(combined);
}

async function decrypt(ciphertext, key) {
  const combined = fromBase64(ciphertext);
  const iv = combined.slice(0, IV_BYTES);
  const data = combined.slice(IV_BYTES);
  const plainBuffer = await globalThis.crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    data,
  );
  return new TextDecoder().decode(plainBuffer);
}

async function createVerification(key) {
  return encrypt(VERIFICATION_PLAINTEXT, key);
}

async function verifyKey(key, token) {
  try {
    const result = await decrypt(token, key);
    return result === VERIFICATION_PLAINTEXT || result === LEGACY_VERIFICATION_PLAINTEXT;
  } catch {
    return false;
  }
}

export async function setupEncryptionFromPin(pin, iterations = DEFAULT_ITERATIONS) {
  const salt = generateSalt();
  const key = await deriveKey(pin, salt, iterations);
  const verificationToken = await createVerification(key);
  const keyBase64 = await exportKeyToBase64(key);
  return {
    saltBase64: toBase64(salt),
    verificationToken,
    keyBase64,
  };
}

export async function unlockEncryptionWithPin({
  pin,
  saltBase64,
  verificationToken,
  iterations = DEFAULT_ITERATIONS,
}) {
  const salt = fromBase64(saltBase64);
  const key = await deriveKey(pin, salt, iterations);
  const valid = await verifyKey(key, verificationToken);
  if (!valid) return null;
  return exportKeyToBase64(key);
}
