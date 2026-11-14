import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

const integration = process.env.RUN_DB_INTEGRATION === "true" ? describe : describe.skip;
afterAll(async () => { await db.$disconnect(); });

integration("GitHub token encryption at rest", () => {
  it("encrypts new Account tokens and lazily re-encrypts legacy plaintext", async () => {
    const savedKey = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const raw = new PrismaClient();
    const user = await db.user.create({ data: { email: `token-encryption-${crypto.randomUUID()}@forge.test` } });
    const providerAccountId = crypto.randomUUID();
    try {
      await db.account.create({ data: { userId: user.id, type: "oauth", provider: "github", providerAccountId, access_token: "new-access", refresh_token: "new-refresh" } });
      const stored = await raw.account.findUniqueOrThrow({ where: { provider_providerAccountId: { provider: "github", providerAccountId } } });
      expect(stored.access_token).toMatch(/^gcm:v1:/);
      expect(stored.refresh_token).toMatch(/^gcm:v1:/);
      expect(stored.access_token).not.toContain("new-access");
      expect(await db.account.findUniqueOrThrow({ where: { provider_providerAccountId: { provider: "github", providerAccountId } } })).toMatchObject({ access_token: "new-access", refresh_token: "new-refresh" });

      const legacyAccountId = crypto.randomUUID();
      await raw.account.create({ data: { userId: user.id, type: "oauth", provider: "github", providerAccountId: legacyAccountId, access_token: "legacy-access", refresh_token: "legacy-refresh" } });
      expect(await db.account.findUniqueOrThrow({ where: { provider_providerAccountId: { provider: "github", providerAccountId: legacyAccountId } } })).toMatchObject({ access_token: "legacy-access", refresh_token: "legacy-refresh" });
      const migrated = await raw.account.findUniqueOrThrow({ where: { provider_providerAccountId: { provider: "github", providerAccountId: legacyAccountId } } });
      expect(migrated.access_token).toMatch(/^gcm:v1:/);
      expect(migrated.refresh_token).toMatch(/^gcm:v1:/);
    } finally {
      await db.user.delete({ where: { id: user.id } });
      await raw.$disconnect();
      if (savedKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = savedKey;
    }
  }, 30_000);
});
