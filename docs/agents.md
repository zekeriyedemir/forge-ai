# Agents

Founder → Research → Founder review → Developer → Analyst is the V1 sequence. The founder creates strategy and tasks, research drafts a market research outline, the second founder pass reviews new context, the developer creates an MVP plan, and the analyst records risks and next actions.

Every run has an ID, workflow ID, step, agent type, input, status, structured output, events, provider/model metadata, timestamps, and error. Tools validate data with Zod before writing. The provider interface can be extended without changing the runtime.

The demo provider uses deterministic templates. Its market content is explicitly labeled unverified. The live OpenAI-compatible provider uses JSON mode but has no external research tool, so it must not claim to have checked market facts.
