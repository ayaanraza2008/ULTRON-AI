# Automatic Diagram Design skill

ULTRON selectively integrates the Agent Skill from [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design) (MIT). It is not a JavaScript package that ULTRON can import as a rendering engine; the skill is a set of instructions and reference files for producing editorial-quality, self-contained HTML/SVG diagrams.

## Automatic behavior

- Detects diagram intent and selects a likely type (architecture, flowchart, sequence, ER/data model, state, timeline, swimlane, quadrant, Gantt, data flow, deployment, dependency, UML class, journey, or a generic flowchart).
- On diagram requests only, retrieves the core `SKILL.md`, one matching type reference, and the output specification from the fixed upstream repository.
- Uses bounded requests (up to three reference files, a 7-second timeout per file, 10,000 characters per file). If upstream retrieval fails, the agent still has its local selection and baseline rules.
- Treats upstream content and imported diagram sources as untrusted reference data; never executes scripts embedded in them.
- Instructs the model to return a complete self-contained HTML/SVG artifact when requested. This backend endpoint returns model output; it does not claim that the application saved, rendered, or exported a file unless a separate storage/rendering feature confirms it.
- Uses existing project branding when available. Otherwise, it proceeds with a restrained editorial default rather than interrupting the user with a setup questionnaire.

## Introspection

Authenticated endpoint: `GET /api/agent/diagram-skills?task=Create%20an%20architecture%20diagram`

The response reports whether diagram intent was detected, the selected type, references, and baseline rules.

## Upstream attribution

- Repository: https://github.com/cathrynlavery/diagram-design
- Core skill: https://github.com/cathrynlavery/diagram-design/blob/main/skills/diagram-design/SKILL.md
- Output specification: https://github.com/cathrynlavery/diagram-design/blob/main/skills/diagram-design/references/output-spec.md
- License: MIT

This is a selective on-demand runtime integration, not a local mirror of the entire upstream repository. Only fixed, known upstream reference paths are requested; retrieved files are capped and never executed.
