import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url().regex(/^postgres(?:ql)?:\/\//),
  DIRECT_URL: z.url().regex(/^postgres(?:ql)?:\/\//).optional(),
  AUTH_SECRET: z.string().min(32),
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.url().regex(/^https?:\/\//).optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  DEVELOPER_PROPOSAL_MAX_COMPLETION_TOKENS: z.coerce.number().int().min(1024).max(32768).default(8192),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
});

export function serverEnv() {
  return schema.parse(process.env);
}
