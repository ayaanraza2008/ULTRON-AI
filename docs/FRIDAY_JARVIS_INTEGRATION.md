# Friday Mark 2 + JARVIS Experiment capability adaptation

## Integration approach

ULTRON remains the primary Node/Express + Supabase runtime. These Python projects are not copied wholesale: replacing ULTRON's authenticated API, per-user RLS, provider routing, task worker, and desktop trust boundary with a separate assistant runtime would create duplicated sources of truth and unsafe execution paths.

### Friday Mark 2 concepts

- The existing memory_items table is mapped at runtime into six cognitive layers: working context (request history), short-term recall, episodic memory, semantic knowledge, procedural lessons, and profile/preferences.
- Account-owned memories are ranked for the current task; inferred memories use exponential decay with a 45-day half-life and are hidden below a confidence/age threshold without deleting them.
- Explicit memories with source=user_approved do not decay.
- Clear user corrections can create a generic, reusable response-quality lesson. The raw correction is never persisted, capture respects the user's memory preference, and lessons remain scoped to the authenticated account.
- The current ULTRON model/tool policy remains authoritative. Memory and retrieved text are untrusted context, not instructions.

### JARVIS Experiment concepts

- Keep ULTRON's existing voice-language preferences, browser speech path, wake-word companions, audio adapters, and authenticated Windows companion boundary.
- Keep the JARVIS-inspired separation between model reasoning and deterministic tool dispatch, using ULTRON's existing allowlisted agent tools and approval policy.
- Do not port its default pyautogui/shell-style PC controls, always-on screen capture loop, or LiveKit development secrets into the cloud API. A cloud-hosted process cannot safely control the user's local PC directly; any future screen/device action must be opt-in, paired, authenticated, visibly permissioned, and allowlisted.
- Do not add Redis/ChromaDB merely to duplicate ULTRON's existing Supabase + optional AgentMemory storage.

## License and provenance

Friday_mark2 did not expose a root LICENSE, LICENSE.md, LICENSE.txt, or COPYING file during this review, so its source code is not copied. The memory behavior above is an independent adaptation of general architectural concepts. jarvis_experiment declares MIT; its implementation was reviewed for architectural ideas, but no source files were copied. ULTRON's existing code and licensing remain in place.

## Verification scope

The unit tests cover layer classification, relevance ranking, expiry handling, inferred-memory decay, immunity for user-approved memories, and correction-to-lesson extraction. These tests do not prove live Supabase RLS, provider connectivity, model quality, or physical-device behavior.
