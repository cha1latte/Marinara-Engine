# Generation Parameters

Marinara's chat modes (Conversation, Roleplay, Visual Novel, Game) all use a shared set of generation parameters per LLM connection. These control how the model samples responses — temperature, top-p, max tokens, and so on — and live in each connection's settings under **Settings → Connections → edit a connection → Generation Parameters**.

This is the canonical reference. Mode-specific guides reference this doc rather than repeating the table.

## Defaults

When you create or open a connection without overrides, parameters start from these built-in defaults (`ROLEPLAY_PARAMETER_DEFAULTS` in `packages/client/src/components/ui/GenerationParametersEditor.tsx`):

| Parameter          | Default   | Notes                                                                                                                                |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `temperature`      | `1`       | Higher = more variety; lower = more deterministic. See Claude note below.                                                            |
| `maxTokens`        | `8192`    | Cap on response length. Raise if responses get truncated — Game Mode world-gen in particular benefits from `10000` or higher because the structured JSON output is large. |
| `topP`             | `1`       | See Claude note below.                                                                                                               |
| `topK`             | `0`       | Disabled; most providers ignore it anyway.                                                                                           |
| `frequencyPenalty` | `0`       |                                                                                                                                      |
| `presencePenalty`  | `0`       |                                                                                                                                      |
| `reasoningEffort`  | `maximum` | Used by reasoning-capable models (Claude with extended thinking, OpenAI o-series). Ignored on non-reasoning models.                  |
| `verbosity`        | `high`    | Used by GPT-5-family models. Ignored elsewhere.                                                                                      |

These work as a starting point — tune from there.

## Tuning

Most users don't need to change these. If you do:

- **Output feels stilted or repetitive:** raise `temperature` slightly (e.g. `1.1` to `1.3`).
- **Output feels chaotic or off-task:** lower `temperature` (e.g. `0.7` to `0.9`).
- **Output gets cut off mid-sentence or mid-JSON:** raise `maxTokens`.
- **A character keeps repeating phrasing across turns:** raise `frequencyPenalty` or `presencePenalty` slightly (e.g. `0.3` to `0.6`).

For ongoing chat or roleplay turns, `temperature` somewhere in the `0.8`–`1.0` range tends to feel balanced — but this is rule of thumb, not a tested recommendation. Different models respond differently; what works on one connection may not transfer.

## Per-backend gotchas

- **Claude (any provider — Anthropic, AWS Bedrock, etc.)** — do **not** set both `temperature` and `topP`. The API rejects the request with `Bad Request: temperature and top_p cannot both be specified for this model`. Leave one of them unset (not at its default — actually unset). Save and retry.

- **Claude thinking mode** — when extended thinking is enabled, `temperature`, `topP`, `presencePenalty`, and `frequencyPenalty` are all ignored. Output is shaped by reasoning budget, not sampler tuning. To change behavior, change the prompt or the model rather than these knobs. `reasoningEffort` and `maxTokens` still apply.

- **OpenRouter** — sampler behavior depends on the underlying model your route resolves to. If you're using `openrouter/auto`, `openrouter/free`, or any other auto-routing model, your sampler settings may behave inconsistently between calls because the underlying model can change. Pinning a specific model keeps behavior predictable.

## Found this confusing? Tell us

Same channels as the rest of the user docs — [join the Discord](https://discord.com/invite/KdAkTg94ME) or [open a GitHub issue](https://github.com/Pasta-Devs/Marinara-Engine/issues) if a parameter behavior didn't match what's described here, or if your provider has a sampler quirk that should be added.
