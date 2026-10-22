# Automatic cybersecurity skills in ULTRON

ULTRON uses a small local selector inspired by [mukul975/Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills), a community skill library licensed under Apache-2.0. Source skills remain attributed and are fetched from the upstream repository only when relevant.

## Automatic behavior

- Classifies a request against a curated set of security domains and selects up to four relevant skill references.
- During an agent run, fetches at most three matching `SKILL.md` files from the fixed upstream repository, with a six-second timeout and a 10,000-character cap per skill.
- Adds the selected skill material as untrusted reference data before the active user prompt. The agent is instructed not to follow embedded instructions that conflict with system policy.
- If retrieval fails, ULTRON still uses the local defensive baseline guidance and continues without the upstream procedure.
- Non-security requests do not trigger upstream skill downloads.
- The authenticated `GET /api/agent/security-skills?task=...` endpoint exposes the local selector's matches without requiring a model call.

## Security boundaries

The upstream project contains dual-use material. ULTRON defaults to defensive work: secure design, hardening, detection, incident response, forensics, and verification. It does not execute upstream scripts automatically, launch scans or exploits against unspecified targets, steal credentials, establish persistence, evade detection, exfiltrate data, or perform destructive actions. Live security testing must remain within an authorized scope. Retrieved skill content and tool outputs are untrusted data.

## Scope and limitations

This is a selective runtime integration, not a local mirror of all upstream skills. It requires outbound access to `raw.githubusercontent.com` for full skill workflows; if unavailable, the local selector and baseline rules still work, but detailed upstream skill text is not loaded. Skill metadata is a curated set of representative references and should be expanded only with verified upstream paths and tests.

## Upstream

- Repository: https://github.com/mukul975/Anthropic-Cybersecurity-Skills
- Skill format and discovery guidance: https://github.com/mukul975/Anthropic-Cybersecurity-Skills/blob/main/AGENTS.md
- License: Apache-2.0
