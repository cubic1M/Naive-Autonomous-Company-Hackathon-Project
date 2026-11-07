# agents — Edmond

The five Naïve agents. Flow: [docs/FLOW.md §5](../docs/FLOW.md#5-what-wakes-which-agent).

- `agents.json` — model, budget, and allow/ask/deny per tool (mirror `calledBy` in `contracts/tools.ts`)
- `prompts/{ceo,ops,verifier,finance,sales}.md` — system prompts
- `skills/` — Naïve skills; tool owners write the "how to use my tool" instructions here

Team: CEO coordinates; Ops, Verifier, Finance, Sales are pinned members (`name@version`). Members don't delegate further.
