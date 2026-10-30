# ULTRON Local Assistant

A separate Python terminal companion that adds local-first chat, specialist agents, document research with citations, guarded code tools, opt-in Gmail/Calendar digest, native speech, hardware inspection, and a reviewed skill library. It does not change ULTRON's Node backend or send private file contents to a hosted LLM.

## Privacy and safety defaults

- Local inference uses Ollama's loopback HTTP endpoint only: `127.0.0.1`, `localhost`, or `::1`. Remote Ollama URLs are rejected.
- No model, Python ML runtime, credential, or Google integration is downloaded/configured automatically.
- Google access is opt-in; Gmail and Calendar use read-only OAuth scopes. The Google APIs are still contacted to retrieve the data, but the digest is summarized by local Ollama and spoken through the installed operating-system voice. No Google data is sent to a cloud LLM by this package.
- Local document search reads selected text file types under a chosen workspace, skips hidden/build/dependency folders and likely secret files, and emits relative paths with line ranges.
- Code revisions are written to the user's private app-data drafts folder rather than overwriting the source. Running scripts uses the current OS user's permissions and is **not** an OS sandbox; review the code and explicitly type the confirmation phrase.
- Online skill repositories are treated as untrusted. Git is used to inspect a public GitHub repository, and only `SKILL.md` Markdown text is copied. No Python, shell, binary, or repository plugin code is executed/installed.
- Local model pulls and skill installs require an explicit interactive confirmation. The default `doctor` command never downloads models.

## Install

Python 3.10 or newer is required. Install Ollama separately using its official installer and start it locally. The base ULTRON assistant has no Python dependencies beyond the standard library.

From the ULTRON repository root, run the guided installer:

~~~powershell
.\tools\local-assistant\setup.ps1
~~~

The guided script creates an isolated virtual environment, installs the CLI, and runs the hardware doctor. It does not download a model or ask for Google access by default. Opt-in flags:

~~~powershell
# Add optional local PDF/DOCX readers:
.\tools\local-assistant\setup.ps1 -WithDocuments

# Add read-only Gmail/Calendar client libraries (OAuth consent is still required later):
.\tools\local-assistant\setup.ps1 -WithGoogle

# Offer to install Ollama using winget; typed confirmation is required:
.\tools\local-assistant\setup.ps1 -InstallOllama

# Explicitly request a model download; a second typed PULL confirmation is required:
.\tools\local-assistant\setup.ps1 -PullModel
~~~

If you prefer a manual install:

~~~powershell
py -m venv tools/local-assistant/.venv
tools\local-assistant\.venv\Scripts\python.exe -m pip install -e tools/local-assistant
tools\local-assistant\.venv\Scripts\ultron-local.exe doctor
tools\local-assistant\.venv\Scripts\ultron-local.exe agents
~~~

## Local model recommendation

The doctor command detects OS, architecture, CPU count, memory, and a limited set of installed discrete-GPU tools, then recommends tags. It queries the Ollama model list but does not pull anything. For a machine with 8 GB RAM and integrated AMD graphics, start CPU-first with a small model such as `qwen2.5:1.5b` or `llama3.2:1b`; treat larger models as optional experiments, not assumed capabilities. Exact performance depends on quantization, available memory, operating-system overhead, and current Ollama/model support.

To explicitly download the recommended small model, use `ultron-local model pull qwen2.5:1.5b` and type `PULL` after reviewing the prompt. Then try `ultron-local chat`. Model tags and storage requirements can change; the command's model list is only a recommendation, not a guarantee of quality or licensing.

## Agents and commands

~~~powershell
# Read local CPU, RAM, and disk use without network requests or process inventory.
ultron-local health

# Detect hardware and installed local models; no download.
ultron-local doctor
ultron-local model list
ultron-local chat

# Find local-document passages without an LLM, or answer with citations using local Ollama.
ultron-local search "energy bands" --root "C:\Users\YourUser\Documents"
ultron-local research "Explain the difference between conductors and semiconductors" --root "C:\Users\YourUser\Documents"

# Local coding assistant: inspect a file, ask a question with context, or draft a revision.
ultron-local code show src\main.py --root .
ultron-local code ask "Find the bug and suggest tests" --file src\main.py --root .
ultron-local code revise src\main.py --request "Add input validation" --root .
# Inspect the printed diff, then apply the generated private draft if appropriate:
ultron-local code apply "PATH_TO_THE_PRINTED_DRAFT.draft" --root .
ultron-local code run scripts\check.py --root .

# Bounded shell commands; still requires confirmation.
ultron-local shell --command "git status" --root .

# Review online skills before installing; installs Markdown-only SKILL.md files.
ultron-local skills review owner/repository
ultron-local skills install owner/repository
ultron-local skills list
~~~

The `code apply` command asks for the exact `APPLY` confirmation, verifies that both the draft and original source still match their recorded SHA-256 hashes, creates a private backup first, and refuses to overwrite source changes made since the draft was prepared.

For `code run`, scripts may use the user's ordinary file/network/process permissions; the confirmation prompt is not a security sandbox. Do not run unknown code. The shell tool is deliberately allowlisted and is not a general shell. Script and allowlisted-command output is drained concurrently and capped at 1 MB per stream to avoid unbounded memory growth; execution still runs with the user's normal account permissions and is not OS-sandboxed.

## Morning digest: Gmail + Calendar + voice

1. In Google Cloud, create a project, enable Gmail API and Google Calendar API, configure the consent screen, create an OAuth Client ID with application type **Desktop app**, and download the client JSON. Google documents the Python setup for [Gmail](https://developers.google.com/workspace/gmail/api/quickstart/python) and [Calendar](https://developers.google.com/workspace/calendar/api/quickstart/python).
2. Install the optional Google client libraries:

   ~~~powershell
   python -m pip install -e "tools/local-assistant[google]"
   ~~~

3. Store the Desktop OAuth client JSON in the assistant's private user-data folder:

   ~~~powershell
   ultron-local google setup --credentials "C:\Users\YourUser\Downloads\client_secret.json"
   ~~~

4. Run `ultron-local digest`. The first run opens Google's OAuth consent page on this machine. Approve the read-only Gmail and Calendar scopes; a local token is saved with owner-only file permissions where supported. To renew consent later, use `ultron-local digest --reauth`.

The digest reads up to 10 unread messages from the last day using message headers/snippets only and up to 25 upcoming events for the local calendar day. It does not send email, modify events, or read full email bodies. The installed local OS voice speaks the result by default; `--no-speak` prints text only. If there is no local model installed, it falls back to a source-based digest.

Google OAuth requires a Google Cloud project, API enablement, internet access, and explicit user consent. Those credentials and account-specific configuration cannot be created on your behalf from this repository commit.

## Windows desktop companion (outbound-only cloud status)

The cloud companion relay allows a paired Windows PC to report whether it is online. The PC initiates HTTPS heartbeats every 30 seconds; ULTRON does not open a connection to the PC. This is a status-only presence feature, not remote PC control.

1. Sign in to the ULTRON web app with the Supabase account that should own the device.
2. Open **PC and mobile devices** and choose **GENERATE ONE-TIME PAIRING CODE**. The code expires after five minutes and can be redeemed once.
3. On Windows, run the following command with the origin shown in the UI. The CLI prompts for the code without displaying it:

   ~~~powershell
   ultron-local companion pair --server-url "https://YOUR-ULTRON-HOST"
   ~~~

4. Start the foreground heartbeat client:

   ~~~powershell
   # Send one test heartbeat and exit:
   ultron-local companion connect --once

   # Keep the PC online in ULTRON while this terminal remains open:
   ultron-local companion connect
   ~~~

The companion validates that the server URL uses HTTPS on port 443, resolves only public/global IP addresses, pins the connection to the validated IP, preserves TLS hostname verification, blocks redirects, and limits the response size/time. If the connection drops, the foreground client retries with a bounded backoff. A revoked or unknown token stops the client and requires a new pairing.

The device token is returned only once and its hash—not the raw token—is stored in Supabase. The CLI saves the token in the user's private ULTRON app-data directory outside the repository. The local file is protected with restrictive permissions where the operating system supports them; it is not encrypted by Windows Credential Manager. Keep the Windows account and its app-data folder secure. The token is never printed by the CLI and is not committed to Git.

To revoke the device, use **REVOKE** beside it in the web app. To also remove the local credential file, stop the heartbeat client and run:

~~~powershell
Remove-Item "$env:LOCALAPPDATA\ULTRON\local-assistant\companion\device-credentials.json"
~~~

The web app marks a device online only while a heartbeat is newer than 90 seconds. The client must remain running in the foreground; this change does not install a Windows service or startup task.

**Strict boundary:** the cloud relay supports pairing, online presence and revocation only. It has no command queue, remote shell, PowerShell, file, screenshot, process, keyboard or mouse API. The UI must continue to report device control as unavailable. This relay is separate from the optional local loopback status server described below; never expose that local server to the LAN or internet.

### Optional loopback status server for local development

The separate `ultron-local companion token` and `ultron-local companion serve` commands start an authenticated local-only endpoint. It binds only to `127.0.0.1`, validates peer/Host/Origin, requires a high-entropy bearer token, caps concurrent handlers at 16, applies a five-second socket timeout, rate-limits requests, closes connections, and exposes only `GET /v1/ultron/status`.

This loopback server is not needed for cloud heartbeat presence and cannot be reached from Render. Do not open its port to the LAN or internet.

## PDF and DOCX documents

The standard-library install supports text/source/Markdown/CSV/JSON/HTML/YAML files. To index local PDF and DOCX files, install the optional document readers:

~~~powershell
python -m pip install -e "tools/local-assistant[documents]"
~~~

The reader bounds document size, PDF page count, DOCX archive size, and extracted text. Scanned PDFs without a text layer need local OCR, which this package does not install or run by default.

## Skill library behavior

`skills review` shallow-clones the named public GitHub repository into a temporary directory, locates `SKILL.md` files, applies size/file-count limits, and reports simple risk indicators. `skills install` clones again, prompts for typed approval, copies only Markdown instruction files into a per-user app-data folder, and writes a SHA-256 metadata record. It does not run scripts and should not be considered a complete security review; inspect the skill text before using it as agent instructions.

## Tests

The unit tests use temporary files and do not require Ollama, Google credentials, internet access, or model downloads:

~~~bash
python -m unittest discover -s tools/local-assistant/tests -p 'test_*.py'
~~~

This package is a local companion integrated into the ULTRON repository; it does not magically install Ollama or configure the user's PC from GitHub CI. Real Google OAuth, local-model inference, installed system voices, and script behavior must be verified on the target device.


## Local voice mode: wake word + on-device answers

On Windows 10/11, run:

~~~powershell
ultron-local voice
~~~

Say **“Ultron”** before every request, for example “Ultron, explain this error” or “Ultron, open Notepad”. Voice capture uses an already-installed Windows System.Speech recognition language and the default microphone. It recognises one bounded utterance at a time; it does not stream audio to ULTRON's cloud API. Ordinary questions are sent only to the local Ollama loopback endpoint and answered with the selected local model (the default is qwen2.5:1.5b). The existing Windows system speech engine reads responses aloud. No speech model is downloaded automatically.

Optional settings:

~~~powershell
ultron-local voice --locale auto
ultron-local voice --locale hi-IN
ultron-local voice --once
ultron-local voice --no-speak
~~~

If the requested recognizer/language is not installed, voice mode stops with an explanation instead of downloading one. Recognition quality and Hindi/Hinglish accuracy depend on Windows language packs and microphone conditions; test them on the target PC.

### Voice-triggered desktop actions

Voice mode recognises only these fixed desktop intents: open Notepad, File Explorer or Calculator; open Desktop, Documents or Downloads. It does **not** interpret arbitrary spoken shell commands, URLs, paths, file changes, messaging, purchases, shutdown, or security changes.

Every desktop action requires a separate typed **LAUNCH** or **OPEN** confirmation in the interactive terminal after the voice request. The target is still restricted by the local allowlist and recorded in the private bounded audit file. Speech alone is never accepted as approval. This voice loop is local-only; the cloud pairing relay remains status/heartbeat-only and does not remotely control the PC.
