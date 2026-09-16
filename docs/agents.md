# Agents

Founder → Research → Founder review → Developer → Analyst is the V1 sequence. The founder creates strategy and tasks, research drafts a market research outline, the second founder pass reviews new context, the developer creates an MVP plan, and the analyst records risks and next actions.

Every run has an ID, workflow ID, step, agent type, input, status, structured output, events, provider/model metadata, timestamps, and error. One shared Zod contract validates provider output and tool inputs before content is written. Readable metric names are normalized to bounded lowercase snake_case keys; unsafe keys and duplicate normalized keys fail validation. An existing metric's key cannot be reused with a different label or unit. The provider interface can be extended without changing the runtime.

The demo provider uses deterministic templates. Its market content is explicitly labeled unverified. The live OpenAI-compatible provider uses Chat Completions JSON mode, an explicit field contract, and at most one regeneration attempt for malformed output. Complete fenced JSON is accepted, but prose or invalid JSON is not. It has no external research tool, so it must not claim to have checked market facts. Automated tests use fake responses and do not call a paid provider.
