import { test as base, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Real Auth.js database sessions in an isolated test database. No application auth bypass.
export const test = base.extend<{ signedInUser: { id: string; db: PrismaClient } }>({
  signedInUser: async ({ context }, runFixture) => {
    const db = new PrismaClient();
    const user = await db.user.create({ data: { name: "Portfolio reviewer", email: `browser-${crypto.randomUUID()}@example.invalid` } });
    const token = crypto.randomUUID();
    try {
      await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) } });
      await context.addCookies([{ name: "authjs.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax", secure: false }]);
      await runFixture({ id: user.id, db });
    } finally {
      const memberships = await db.workspaceMember.findMany({ where: { userId: user.id, role: "OWNER" }, select: { workspaceId: true } });
      await db.workspace.deleteMany({ where: { id: { in: memberships.map(member => member.workspaceId) } } });
      await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
    }
  },
});

export { expect };
