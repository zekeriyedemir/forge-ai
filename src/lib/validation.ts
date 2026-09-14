import { z } from "zod";

export const projectInput = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(2000).default(""),
  goal: z.string().trim().min(10).max(2000),
});

export const goalInput = z.object({ statement: z.string().trim().min(10).max(2000) });
