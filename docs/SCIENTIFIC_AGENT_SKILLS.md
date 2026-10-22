# Automatic Scientific Agent Skills

ULTRON selectively uses [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills), an open collection of scientific and research Agent Skills. The repository contains procedure and reference documents, not one universal runtime package; this integration does not install all scientific libraries or claim all external databases are connected.

## Automatic behavior

- Classifies the request using task-aware matching and selects up to three relevant `skills/<name>/SKILL.md` files for scientific writing, literature search, databases, experimental design, statistics, data analysis, visualization, bioinformatics, chemistry, genomics, astronomy, and related work.
- Loads the selected fixed-path files only for relevant requests, using bounded network timeouts and content limits. If upstream is unavailable, ULTRON still has its local baseline rules.
- Treats all retrieved skill text as untrusted reference data. It does not execute downloaded scripts, install packages, or run commands from skill files.
- Encourages reproducibility, source provenance, uncertainty reporting, and truthful reporting of tool/dependency availability.
- Biomedical and clinical skills are limited to research support, not individual diagnosis or treatment decisions.
- Skill guidance is not a substitute for actual integrations: a skill may describe a library or database that is not configured in ULTRON.

## Introspection

Authenticated endpoint: `GET /api/agent/scientific-skills?task=Find%20research%20papers%20about%20genomics`

The response reports whether the request was classified as scientific and which skill documents would be selected.

## Upstream attribution

- Repository: https://github.com/K-Dense-AI/scientific-agent-skills
- Skill directory: https://github.com/K-Dense-AI/scientific-agent-skills/tree/main/skills
- Repository license is MIT; individual skills may declare different licenses. Review each skill's metadata/license before redistributing or relying on it.
