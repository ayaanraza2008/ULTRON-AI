# ULTRON Model Lab

A local Python companion for testing Hugging Face causal language models, calibrating a small set of decoding parameters, and chatting from the terminal. It is separate from ULTRON's Node.js server so large model downloads and GPU memory use do not happen on the hosted backend.

## Scope and model integrity

- Loads an openly accessible or user-authorized Hugging Face model by repository ID.
- Benchmarks four decoding presets on a small fixed suite of benign helpfulness tasks and safety-boundary checks.
- Selects a preset only when all included safety checks are recognized as refusals. If none passes, the profile is marked ineligible and chat falls back to conservative greedy decoding.
- Saves a local JSON profile and benchmark metrics. **It does not edit model weights or remove safety alignment.** The scores use simple refusal-text matching and answer-length proxies; they are not an intelligence benchmark or a safety certification.
- Provides optional local chat, unchanged model snapshot download, and private-by-default publication of the JSON profile to Hugging Face Hub.
- Keeps the inference runtime optional. Existing Node.js startup and tests do not need PyTorch.

## Install

Use Python 3.10 or newer in a virtual environment. Install a PyTorch build appropriate for your platform first; then install the remaining dependencies:

\`\`\`bash
python -m venv .venv
# Windows PowerShell:
.venv\\Scripts\\Activate.ps1
# macOS/Linux:
source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install -r tools/model-lab/requirements.txt
python tools/model-lab/ultron_model_lab.py doctor
\`\`\`

The model itself is downloaded from Hugging Face on first use. Start with a small model that fits the machine. An 8 GB RAM PC with integrated AMD graphics should begin with CPU inference and a small model; CUDA bitsandbytes 4-bit loading is not expected to work on an ordinary Windows AMD-integrated graphics setup. The **doctor** command reports what PyTorch can actually access.

## Commands

Calibrate a model and save the profile:

\`\`\`bash
python tools/model-lab/ultron_model_lab.py calibrate Qwen/Qwen2.5-0.5B-Instruct --device auto --output .local/ultron-model-profile.json
\`\`\`

Run without the interactive next-step menu (useful for scripts and CI):

\`\`\`bash
python tools/model-lab/ultron_model_lab.py calibrate Qwen/Qwen2.5-0.5B-Instruct --device cpu --no-prompt
\`\`\`

Start terminal chat, optionally applying a profile that passed the safety gate:

\`\`\`bash
python tools/model-lab/ultron_model_lab.py chat Qwen/Qwen2.5-0.5B-Instruct --profile .local/ultron-model-profile.json
\`\`\`

Use 4-bit loading on a compatible CUDA GPU:

\`\`\`bash
python tools/model-lab/ultron_model_lab.py chat organization/model --device cuda --load-in-4bit
\`\`\`

Download an unchanged source snapshot locally:

\`\`\`bash
python tools/model-lab/ultron_model_lab.py snapshot organization/model --output ./models/source-model
\`\`\`

Publish only the calibration profile, defaulting to a private dataset repository:

\`\`\`bash
# Authenticate using the Hugging Face CLI login, or set HF_TOKEN in your shell.
python tools/model-lab/ultron_model_lab.py publish-profile .local/ultron-model-profile.json --repo-id YOUR_USERNAME/ultron-calibration
\`\`\`

The publish command uploads only the JSON profile, not model weights. Making the profile public requires **--public**. Never commit access tokens. The **--trust-remote-code** switch is off by default; enable it only for repositories whose code you have reviewed.

## Tests

The unit tests do not download a model or require PyTorch:

\`\`\`bash
python -m py_compile tools/model-lab/ultron_model_lab.py
python -m unittest discover -s tools/model-lab -p 'test_*.py'
\`\`\`

The calibration suite is intentionally small. Review model outputs manually and extend the cases for your own use before treating a profile as suitable for production.
