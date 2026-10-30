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

## Windows desktop companion (local status only)

The optional companion process exposes a small authenticated status endpoint from the Windows PC itself. It is standard-library-only and does not install a service, add a startup task, or change firewall rules.

Open PowerShell in the same user session as the installed CLI:

~~~powershell
# Generate a fresh 256-bit bearer token and keep it in this PowerShell session.
# The assignment captures the token without echoing it to the console.
$env:ULTRON_COMPANION_TOKEN = (ultron-local companion token).Trim()

# Optional: permit one exact local ULTRON UI origin to call the companion from a browser.
# Leave unset when a browser client is not being used.
$env:ULTRON_COMPANION_ALLOWED_ORIGINS = "http://localhost:5173"

# Start the companion; it binds only to IPv4 loopback.
ultron-local companion serve --port 8765
~~~

In another PowerShell window, test the read-only status route:

~~~powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8765/v1/ultron/status" -Headers @{
  Authorization = "Bearer $env:ULTRON_COMPANION_TOKEN"
}
~~~

The service rejects non-loopback clients, mismatched Host headers, unlisted browser origins, bad bearer tokens, unsupported routes, and excess requests. The device identity is a random UUID stored under the user's ULTRON app-data directory. The bearer token is generated on demand and is not written to the repository or a config file; generate a new token and restart the service to rotate it.

**Important boundary:** this local service reports status only. It cannot execute commands, browse files, capture the screen, control the mouse/keyboard, install applications, or change Windows settings. It does not automatically connect to a cloud-hosted ULTRON backend: a Render service cannot call a PC's `127.0.0.1`. The existing server-side desktop adapter still requires a separately designed, authenticated, publicly reachable HTTPS gateway, which is not supplied by this local process. Do not expose this port to the LAN or the public internet.

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
