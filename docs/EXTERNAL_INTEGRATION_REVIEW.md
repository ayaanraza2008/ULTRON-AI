# External Repository Compatibility Review

This review is an initial source-level assessment, not a legal opinion or a claim that the components have been installed or run. Source code, model weights, datasets, bundled assets, and third-party dependencies can carry different terms.

## Summary

| Repository | Verified source license / characteristics | Proposed integration | Current decision |
|---|---|---|---|
| [HeyGem.ai](https://github.com/suifeng9203/HeyGem.ai) | README identifies GPU-server requirements for local deployment. Repository LICENSE is the Silicon Intelligence Community License, not a standard permissive license; it includes attribution/notice conditions and an additional license threshold for products exceeding 1,000 monthly active users under the stated terms. | Optional remote avatar/media service adapter; do not bundle model weights or run it inside the core chat service. | BLOCKED pending legal/redistribution review, model-weight review, and dedicated GPU host. |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Repository LICENSE is GNU GPL-3.0. It is a node-based generation engine with a documented API/workflow ecosystem. Each model/workflow/asset may have its own terms. | Prefer a separate ComfyUI service and a thin adapter. Do not copy ComfyUI code into the ULTRON core without reviewing GPL distribution and source-offer obligations. | Candidate for optional remote generation service after license and host review. |
| [OmniVoice](https://github.com/k2-fsa/OmniVoice) | Repository LICENSE is Apache-2.0. README describes a multilingual TTS model and claims 600+ languages. That does not independently prove quality for every language or that model weights/data share the source license. | TTS adapter behind a replaceable provider interface. Verify model card, weight terms, language coverage, runtime, memory, latency, and voice-cloning consent constraints. | Candidate; not installed or benchmarked. |
| [Handy](https://github.com/cjpais/Handy) | Repository LICENSE is MIT. README describes offline desktop speech transcription and supported Windows/macOS/Linux workflows. | Evaluate a local STT companion/IPC workflow rather than copying the entire desktop app into the web backend. Confirm exact CLI/IPC interface and model requirements first. | Candidate; not installed or tested. |
| [ai-employees](https://github.com/markfulton/ai-employees) | Repository LICENSE is MIT. README describes role-based routines and schedules across several agent harnesses. Routine content can still cause consequential browser/PC actions if adopted carelessly. | Adapt task templates, routine metadata, scheduling patterns, and progress reporting into ULTRON's bounded task system. Do not import every routine or grant broad permissions by default. | Candidate for selective adaptation; no code copied. |

## Hardware and hosting

The local target is 8 GB RAM with integrated AMD Radeon graphics and no assumed CUDA support. Therefore:
- Do not auto-download large voice, avatar, image, or video model weights.
- Do not run all external repositories as permanent background services.
- Keep image/video/avatar generation separate from interactive chat.
- Measure RAM, startup time, latency, and failure recovery on the intended host before enabling an integration.
- A remote service may add cost; no paid service should be silently enabled.

## Required before integration

1. Pin a source revision and record its commit.
2. Review the root license and relevant subdirectory/model/dataset licenses.
3. Review dependency licenses and any attribution/notice requirements.
4. Record expected CPU/RAM/GPU/disk and runtime requirements.
5. Define a narrow adapter contract and timeout/cancellation behavior.
6. Add tests with mocks; then run real integration tests on authorized infrastructure.
7. Mark features TESTED only after actual tests pass and VERIFIED_IN_DEPLOYMENT only after deployed evidence exists.
