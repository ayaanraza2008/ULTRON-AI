# Task-aware skills in ULTRON

ULTRON selects lightweight skill guidance from the current task for software changes, research, defensive security, diagram design, and scientific workflows. The selector is deterministic and available through authenticated `GET /api/agent/task-skills?task=...`; the same guidance is injected into the agent's system context for each request.

This is a selector and policy layer, not a claim that third-party packages, scientific databases, diagram renderers, scanners, or external skill repositories are installed or executed. Upstream source links are references only. External actions remain subject to the existing approval gate and tool allowlists.

Sources: https://github.com/ai-boost/awesome-harness-engineering, https://github.com/mukul975/Anthropic-Cybersecurity-Skills, https://github.com/cathrynlavery/diagram-design, https://github.com/K-Dense-AI/scientific-agent-skills.
