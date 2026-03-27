---
name: package-versions
description: Reads package.json and outputs a formatted table of all dependency versions plus AI model IDs in use. Use this before making any changes that involve external package APIs to ensure you are using the correct version and calling the right methods.
---

Read the file at `c:/Projects/Roastie/package.json` and `c:/Projects/Roastie/src/lib/constants.ts`.

Output two sections:

## 1. Package Versions

A Markdown table with **Production Dependencies** and **Dev Dependencies** sections. For each package show: name, declared version range.

After the table, include these API usage notes for the packages most likely to cause version-related mistakes:

- **`@google/genai` ^1.x** — use `new GoogleGenAI({ apiKey })` then `ai.models.generateContent(...)`. Do NOT use the older `ai.generateContent()` top-level method.
- **`zustand` ^5.x** — use `create<State>((set) => ...)`. Do NOT use the curried v4 form `create<State>()(...)`.
- **`react` ^19.x** — `forwardRef` is still valid. `useRef` type changed: prefer `React.RefObject<T>` over `MutableRefObject`. Ref callbacks now support cleanup return values.
- **`three` ^0.175.x** — check the Three.js migration guide for any deprecated APIs before using geometry or material constructors.
- **`@anthropic-ai/sdk` ^0.39.x** — installed but NOT used in any routes yet. If adding Anthropic routes, the current recommended models are `claude-sonnet-4-6` and `claude-opus-4-6` (confirm these haven't changed).

## 2. AI Models Currently in Use

Read `VISION_MODEL`, `ROAST_MODEL`, and `ELEVENLABS_VOICE_ID` from `src/lib/constants.ts` and display them in a table with their purpose.

End with this reminder:
> These are declared ranges — resolved versions in node_modules may be newer within the range. Target the minimum of the declared range when writing code.
