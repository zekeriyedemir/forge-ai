import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const prefix = "gcm:v1:";
const ivLength = 12;

function encryptionKey() {
  const encoded = process.env.TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("TOKEN_ENCRYPTION_KEY must be configured before storing or migrating GitHub tokens.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.");
  }
  return key;
}

export function isEncryptedToken(value: string) {
  return value.startsWith(prefix);
}

export function encryptToken(value: string) {
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${prefix}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptToken(value: string) {
  if (!isEncryptedToken(value)) return value;
  const [scheme, version, ivValue, tagValue, ciphertextValue, extra] = value.split(":");
  if (scheme !== "gcm" || version !== "v1" || !ivValue || !tagValue || ciphertextValue === undefined || extra !== undefined) {
    throw new Error("Stored GitHub token has an invalid encrypted format.");
  }
  const iv = Buffer.from(ivValue, "base64");
  const tag = Buffer.from(tagValue, "base64");
  const ciphertext = Buffer.from(ciphertextValue, "base64");
  if (iv.length !== ivLength || tag.length !== 16) throw new Error("Stored GitHub token has an invalid encrypted format.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored GitHub token could not be decrypted. Check TOKEN_ENCRYPTION_KEY.");
  }
}
