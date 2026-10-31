# ULTRON Live AI Provider Acceptance

This is a manual GitHub Actions smoke test for real OpenRouter-compatible text and vision inference. It uses only synthetic prompts and a synthetic 64×64 image; it does not read ULTRON user data or send uploaded photos.

## Required repository secret

Add `ULTRON_OPENROUTER_API_KEY` under GitHub Settings → Secrets and variables → Actions. Never paste the key into chat, source code, workflow inputs, or logs.

## How to run

1. Open GitHub Actions → **ULTRON Live AI Provider Acceptance**.
2. Select the `main` branch.
3. Choose YES for text and/or vision only when you explicitly want to send the synthetic challenge to OpenRouter.
4. Run the workflow and inspect the redacted result.

Both checks use `openrouter/free`; vision is constrained to the same free route. The scripts have bounded timeouts and response sizes and report only provider/model/status diagnostics. They never print the API key, challenge response text, raw upstream errors, personal prompts or image data.

If the secret is missing or the provider rejects the free route, the check fails closed. No paid model ID is configured as a fallback. A successful text check proves one synthetic completion; a successful vision check proves one synthetic image-understanding challenge. Neither proves conversational quality, user uploads, microphone/camera capture, memory, account isolation, or every model's availability.

The workflow does not deploy services or update Render/Supabase settings. Merging any change into `main` may still trigger the existing Render auto-deploy policy; review that separately before merging.
