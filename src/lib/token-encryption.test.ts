import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken, isEncryptedToken } from "./token-encryption";

const key = Buffer.alloc(32, 7).toString("base64");

afterEach(() => vi.unstubAllEnvs());

describe("GitHub token encryption", () => {
  it("uses fresh AES-GCM ciphertext and decrypts it only with the configured key", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", key);

    const first = encryptToken("github-access-token");
    const second = encryptToken("github-access-token");

    expect(isEncryptedToken(first)).toBe(true);
    expect(first).not.toContain("github-access-token");
    expect(second).not.toBe(first);
    expect(decryptToken(first)).toBe("github-access-token");
  });

  it("rejects missing, malformed, and incorrect keys rather than storing plaintext", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(() => encryptToken("token")).toThrow("TOKEN_ENCRYPTION_KEY must be configured");

    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "not-base64-key");
    expect(() => encryptToken("token")).toThrow("32-byte key");

    vi.stubEnv("TOKEN_ENCRYPTION_KEY", key);
    const encrypted = encryptToken("token");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
    expect(() => decryptToken(encrypted)).toThrow("could not be decrypted");
  });

  it("leaves legacy plaintext readable for lazy database migration", () => {
    expect(decryptToken("legacy-token")).toBe("legacy-token");
    expect(isEncryptedToken("legacy-token")).toBe(false);
  });
});
