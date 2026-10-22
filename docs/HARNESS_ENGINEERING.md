# Harness Engineering Runtime

ULTRON selectively implements engineering patterns inspired by [ai-boost/awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering). The upstream repository is a curated reading list and templates collection, not a drop-in runtime library; ULTRON therefore adopts relevant principles rather than copying the entire list into production.

## Runtime behavior

- Automatic task classification for software changes, research, multi-step work, memory/context tasks, and consequential actions.
- Task-specific guidance is injected into the authenticated agent loop without requiring the user to name a tool.
- Tool output and retrieved content are treated as untrusted data.
- Narrow changes and evidence-based verification are preferred; configured is not the same as reachable, and a patch is not proof of successful tests or deployment.
- Bounded recovery and concise checkpoints are encouraged for longer tasks.
- Existing allowlists, user scoping, and explicit authorization gates remain authoritative. The harness policy does not grant new system privileges.

## API

Authenticated `GET /api/agent/harness` returns the policy version, source attribution, and the rules that are active in the agent runtime. Optional query parameter `task` returns task-specific categories and additional guidance. It does not expose credentials or execute tasks.

## Boundaries

This integration does not add arbitrary shell execution, autonomous repository merges, unrestricted PC control, or permission bypasses. External tools must still be explicitly implemented, configured, and verified. Upstream source: https://github.com/ai-boost/awesome-harness-engineering
