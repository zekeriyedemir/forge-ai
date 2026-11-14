import { PrismaClient } from "@prisma/client";
import { decryptToken, encryptToken, isEncryptedToken } from "./token-encryption";

const globalDb = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalDb.prisma ?? new PrismaClient();

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function encryptValue(value: unknown) {
  return typeof value === "string" && !isEncryptedToken(value) ? encryptToken(value) : value;
}

function encryptedData(value: unknown): unknown {
  if (!record(value)) return value;
  return {
    ...value,
    access_token: encryptValue(value.access_token),
    refresh_token: encryptValue(value.refresh_token),
  };
}

function encryptedArguments<T>(args: T, operation: string): T {
  if (!record(args)) return args;
  const result: Record<string, unknown> = { ...args };
  if (operation === "createMany") {
    const data = result.data;
    result.data = Array.isArray(data) ? data.map(encryptedData) : encryptedData(data);
  } else if (operation === "upsert") {
    const data = record(result.data) ? result.data : {};
    result.data = { ...data, create: encryptedData(data.create), update: encryptedData(data.update) };
  } else if (operation === "create" || operation === "update" || operation === "updateMany") {
    result.data = encryptedData(result.data);
  }
  return result as T;
}

async function decryptedResult(value: unknown): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(decryptedResult));
  if (!record(value)) return value;

  const accessToken = value.access_token;
  const refreshToken = value.refresh_token;
  const result = { ...value };
  if (typeof accessToken === "string") result.access_token = decryptToken(accessToken);
  if (typeof refreshToken === "string") result.refresh_token = decryptToken(refreshToken);

  if (
    typeof value.provider === "string" &&
    typeof value.providerAccountId === "string" &&
    Object.hasOwn(value, "access_token") &&
    Object.hasOwn(value, "refresh_token") &&
    ((typeof accessToken === "string" && !isEncryptedToken(accessToken)) ||
      (typeof refreshToken === "string" && !isEncryptedToken(refreshToken)))
  ) {
    await prisma.account.updateMany({
      where: {
        provider: value.provider,
        providerAccountId: value.providerAccountId,
        access_token: typeof accessToken === "string" ? accessToken : null,
        refresh_token: typeof refreshToken === "string" ? refreshToken : null,
      },
      data: {
        access_token: typeof accessToken === "string" ? encryptToken(accessToken) : null,
        refresh_token: typeof refreshToken === "string" ? encryptToken(refreshToken) : null,
      },
    });
  }
  return result;
}

export const db = prisma.$extends({
  query: {
    account: {
      async $allOperations({ args, operation, query }) {
        const result = await query(encryptedArguments(args, operation));
        return decryptedResult(result);
      },
    },
  },
});

if (process.env.NODE_ENV !== "production") globalDb.prisma = prisma;

export type DbTransaction = Parameters<Parameters<typeof db.$transaction>[0]>[0];
