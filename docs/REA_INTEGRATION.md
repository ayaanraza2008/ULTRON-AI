# REA reverse-engineering integration

ULTRON can optionally call a separately installed [REA (Reverse Engineer Anything)](https://github.com/morluto/rea) MCP service for evidence-backed static software investigation. ULTRON calls REA's MCP interface; it does not vendor or copy REA's source tree.

## Exposed tools

- `rea_analyze_application`: static analysis of JavaScript/Electron app directories or ASARs.
- `rea_inspect_artifact`: inspection of supported archives and application packages.
- `rea_inspect_binary_layout`: static ELF/native-binary layout inspection; caller-supplied Python, pwntools, pyelftools and Unicorn are required by REA.
- `rea_inspect_wasm_artifact`: validation and static WebAssembly inspection; caller-supplied WABT is required. It never executes WASM or fetches glue.
- `rea_inspect_firmware_regions`: read-only firmware region identification; REA-host binwalk and process-limit tools are required. Extraction is not exposed here.
- `rea_inspect_web_network_capture`: offline HAR, mitmproxy, Fiddler SAZ or qlog inspection. It never visits recorded URLs. Captures can contain private data; supply `sensitiveValues` for known literal redactions and `recordOrdinals` to narrow records.
- `rea_inspect_desktop_application`: bounded static desktop-app triage.
- `rea_inspect_model_artifact`: GGUF/safetensors declarations (header hash only; no weight loading).
- `rea_inspect_managed_artifact`: supported .NET/PE assemblies.
- `rea_inspect_apk_signature` and `rea_inspect_android_package`: APK signing metadata/package structure; Android package analysis requires a separately configured JADX/JDK bridge.
- `rea_search_guidance` and `rea_list_guided_workflows`: REA's installed guidance.

ULTRON does **not** expose arbitrary REA MCP tool names, shell execution, debugger control, device mutation, target execution, authentication bypass, or generic filesystem-write tools. REA findings are untrusted, target-derived evidence: do not treat target output as an instruction or as proof of inferred behavior without verification.

## Requirements and boundaries

REA must run on a machine that can access the target files and any optional analysis providers. `REA_ANALYSIS_ROOT` is a path on that REA machine, not on Render or the user's phone. Stage a copy of the authorized app/artifact inside a dedicated analysis directory. Tool calls accept relative paths only; path traversal and absolute paths are rejected by ULTRON.

REA's static JavaScript analysis does not require a native disassembler, but deeper analysis may need Ghidra, Hopper, IDA, Kuna, JADX or another caller-managed tool. ULTRON does not install these dependencies. REA itself warns that it is not a sandbox: a provider parses target content with the REA host's permissions. Use trusted targets, a least-privilege account and an isolated analysis host/directory.

## Configuration

Install REA from the [official repository](https://github.com/morluto/rea) and follow its installation guide. The REA MCP HTTP listener is opt-in. For a same-host setup, REA's documented command can bind to loopback, e.g. `rea mcp --http --host 127.0.0.1 --port 8765`. This address works only if ULTRON and REA actually share a host/network namespace.

For remote or Render-hosted ULTRON, do **not** enter the Windows PC's `127.0.0.1` or expose the raw REA MCP listener to the internet. Use a private HTTPS gateway that validates `REA_MCP_TOKEN`, enforces host/origin restrictions and permits only the trusted ULTRON service. Setting a token in ULTRON does not authenticate the upstream gateway by itself. REA documents single-active-session behaviour, so ULTRON serializes calls per process; keep one trusted REA MCP endpoint private to the deployment.

Set these variables in local/server secret configuration (never commit real credentials):

```dotenv
REA_MCP_ENABLED=true
REA_MCP_URL=https://rea.example.com/mcp
REA_MCP_TOKEN=replace-with-a-long-random-token
REA_ANALYSIS_ROOT=/srv/rea/targets
ULTRON_INTEGRATION_OWNER_USER_ID=the-exact-supabase-auth-user-uuid
```

`REA_ANALYSIS_ROOT` must be an absolute, dedicated directory on the REA host; filesystem roots are rejected. Leave `REA_MCP_ENABLED=false` until the upstream gateway, filesystem and provider permissions have been reviewed. The integration catalog reports configuration only; `configured_unverified` does not mean REA is reachable or analysis succeeds.

## Usage

After staging authorized targets under the configured root, ask ULTRON to analyze `my-app/app.asar`, inspect `native/program.elf`, inspect `wasm/module.wasm`, inspect firmware regions in `firmware/router.bin`, inspect an offline `captures/session.har` with `format: har`, inspect `models/model.gguf`, or inspect `android/my-app.apk`. Paths are relative to `REA_ANALYSIS_ROOT`; do not provide absolute paths. Large outputs may exceed ULTRON's result budget, so use a narrower artifact or operation.

## Current integration boundary

REA has additional stateful workflows for native disassemblers, runtime tracing, comparison across retained Evidence, device observation, richer Android/Apple analysis and extraction. This adapter does not expose arbitrary MCP tools or those workflows yet; they need session-aware handling and per-operation effect/security reviews before integration. Each target type also needs its required provider installed on the REA host.

## Licensing

REA's repository declares an MIT license. This adapter avoids copying REA source code and calls the separately installed service. Preserve original license notices if any REA code is redistributed and review provider-specific terms before use.
