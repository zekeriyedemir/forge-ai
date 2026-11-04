import type { serverEnv } from "@/lib/env";

type CompletionConfig = Pick<ReturnType<typeof serverEnv>, "OPENAI_TOKEN_PARAMETER" | "OPENAI_JSON_MODE">;

export function completionOptions(config: CompletionConfig, maxTokens?: number) {
  return {
    ...(config.OPENAI_JSON_MODE === "true" ? { response_format: { type: "json_object" as const } } : {}),
    ...(maxTokens === undefined ? {} : config.OPENAI_TOKEN_PARAMETER === "max_tokens" ? { max_tokens: maxTokens } : { max_completion_tokens: maxTokens }),
  };
}
