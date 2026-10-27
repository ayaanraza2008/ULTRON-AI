# Vendored ECC skills (pinned snapshot)

This directory contains selected skill Markdown files copied from the upstream Everything Claude Code (ECC) repository at commit `25278e7d7b6cf6e6a4e7a6c8e10f14ff22f0eb5b`.

Upstream: https://github.com/affaan-m/ECC  
License: MIT; see [LICENSE](LICENSE) for the upstream copyright and permission notice. The skill files are under `skills/<name>/SKILL.md`.

ULTRON loads only task-matched skills from these local snapshots. The content is guidance, not executable code. ULTRON-specific system policy and dispatch-time authorization remain authoritative. Skills may mention tools/frameworks that are not installed in ULTRON; those recommendations must not be assumed to be available or appropriate.

To update the snapshots, review the exact upstream change and license, update the pinned revision, retain the license notice, and rerun the ULTRON task-skill and agent-runtime regression tests. No runtime network fetch is necessary.
