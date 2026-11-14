import { z } from "zod";

const userLimitSchema = z.object({
  MAX_PROJECTS_PER_USER: z.coerce.number().int().min(1).max(1000).default(10),
  MAX_WORKFLOW_STARTS_PER_USER_PER_DAY: z.coerce.number().int().min(1).max(1000).default(20),
  MAX_DEVELOPER_PROPOSALS_PER_USER_PER_DAY: z.coerce.number().int().min(1).max(1000).default(5),
});

const schema = z.object({
  DATABASE_URL: z.url().regex(/^postgres(?:ql)?:\/\//),
  DIRECT_URL: z.url().regex(/^postgres(?:ql)?:\/\//).optional(),
  AUTH_SECRET: z.string().min(32),
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.url().regex(/^https?:\/\//).optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_PROPOSAL_MODEL: z.string().trim().min(1).optional(),
  ...userLimitSchema.shape,
  OPENAI_TOKEN_PARAMETER: z.enum(["max_completion_tokens", "max_tokens"]).default("max_completion_tokens"),
  OPENAI_JSON_MODE: z.enum(["true", "false"]).default("true"),
  RESEARCH_PROVIDER: z.enum(["auto", "searxng", "brave"]).default("auto"),
  RESEARCH_SEARXNG_BASE_URL: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  DEVELOPER_PROPOSAL_MAX_COMPLETION_TOKENS: z.coerce.number().int().min(1024).max(32768).default(8192),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
});

export function serverEnv() {
  return schema.parse(process.env);
}

export function userLimits() {
  return userLimitSchema.parse(process.env);
}
