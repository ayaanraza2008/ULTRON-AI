# ULTRON Local Video Studio

A local-first video-production workspace for ULTRON. It adds a small visual board alongside the existing backend; it does not replace ULTRON chat, voice, integrations, authentication, or deployment.

## What it does

- Start from a plain-English brief, or give a public YouTube, Shorts, Instagram/Reel, TikTok, Vimeo, or Facebook video URL as a reference.
- Inspect available URL metadata, chapters and subtitles with yt-dlp; upload a local clip/image to inspect local metadata and make a sampled frame contact sheet.
- Generate three distinct concepts, a draft script, scene timings, research questions and a cost estimate through ULTRON's existing OpenRouter environment. Without the key or with an unavailable model, it creates an explicit local starter plan.
- Search free/archive footage or images from Wikimedia Commons without a provider key. Optionally use the Pexels video search API with PEXELS_API_KEY.
- Upload your own video/image assets, voiceover and licensed music.
- Generate a system-voice WAV locally (Windows SAPI on Windows; eSpeak NG/eSpeak on Linux/macOS when installed); make scene-timed SRT captions.
- Render H.264 MP4 using FFmpeg. Image clips get a slow zoom movement; clips fade in/out. Voice and music can be mixed, and subtitles can be burned when the local FFmpeg build includes subtitle support.
- Track current stage, progress, tools, assets, source/license metadata, activity events and estimated/tracked costs on a polling local board.
- Require explicit human approval, plus a rights confirmation in the UI, before final rendering. The API also rejects rendering until the project is approved and every scene has an asset.

The tool does not auto-publish. Stock search does not guarantee that an asset is safe for every commercial use; verify each source page, license, attribution and restrictions yourself.

## Prerequisites

- Node.js 20 or later and npm.
- FFmpeg with ffmpeg available on PATH, plus FFprobe (ffprobe).
- Optional: yt-dlp for reference URL metadata/subtitles. Some sites may block extraction or require cookies; the studio does not bypass access controls.
- Optional local TTS: Windows includes System.Speech on supported Windows desktop installs; on Linux/macOS, install eSpeak NG or eSpeak.
- Optional network features: an OpenRouter key for model-generated planning, a Tavily key for live research, and a Pexels key for Pexels search. Wikimedia Commons search works without those keys.

## Run locally

From the root of ayaanraza2008/ULTRON-AI:

**Windows PowerShell**

    npm install
    Copy-Item .env.example .env
    # Open .env in an editor and fill only the keys you choose to use.
    npm run video-studio

**macOS / Linux**

    npm install
    cp .env.example .env
    # Open .env in an editor and fill only the keys you choose to use.
    npm run video-studio

The launcher loads simple KEY=value lines from the root .env file; values already set in the shell take precedence. Keep .env private and never commit it. The server binds to 127.0.0.1:4174 by default and prints its URL at startup:

    http://127.0.0.1:4174

This is intentionally loopback-only because the standalone studio writes local media and does not implement remote-user authentication. Do not bind it to a LAN/public interface, reverse proxy it, or expose its port to the internet. The VIDEO_STUDIO_HOST value is rejected unless it is loopback.

Data is stored under .runtime/video-studio/ by default (ignored by Git). To change location, set ULTRON_VIDEO_STUDIO_DATA_DIR. Set VIDEO_STUDIO_PORT to change the port. FFMPEG_PATH, FFPROBE_PATH, YTDLP_PATH, and ESPEAK_PATH can point at executables that are not on PATH.

### Optional keys

- OPENROUTER_API_KEY and OPENROUTER_DEFAULT_MODEL: use the existing ULTRON-configured OpenRouter account for concept and script planning. Configure ULTRON_VISION_MODELS with a vision-capable OpenRouter model if you want local-reference contact sheets sent for visual analysis. Without a vision model, the contact sheet stays local.
- TAVILY_API_KEY: enables the Research the brief action. Research results are saved with source URLs and snippets, but they are leads, not verified facts; open the primary sources and check dates.
- PEXELS_API_KEY: enables Pexels stock-video search. The interface links to the original Pexels page; follow current Pexels API/license terms and credit contributors where appropriate. Wikimedia Commons is the fallback search provider.

Actual hosted-model/search API charges are not metered by this project. The UI distinguishes the tracked value from the model's estimate. A displayed $0 means the studio has not recorded spend, not that a hosted provider necessarily charged nothing. Check your provider dashboard and quotas.

## First production walkthrough

1. Start with a brief and choose 16:9, 9:16 or 1:1, a 10–180-second target, and either real motion footage or image-based movement.
2. Optionally paste a public reference URL. For local reference analysis, create the project, then upload a clip/image from the storyboard's Add reference clip/image action; once its inspection finishes, regenerate the plan.
3. Choose a concept and review the script, research questions, pacing, scene durations and production notes. Edit narration and visual direction and select Save scene edits. Scene durations must stay close to the project duration.
4. Search for footage/images per scene, open each source/license page, then choose Use this asset; or upload a file you own. The scene card should change to ASSET READY.
5. Optionally use Research the brief, generate local voiceover, upload a different voiceover, upload licensed music, and create SRT captions. Listen/watch the pieces before rendering.
6. Confirm that source assets, music and narration are suitable for your intended use, tick the rights-review checkbox, and approve the production. Then choose Render final MP4.
7. Watch the board while the scene segments and final MP4 render. Download the MP4; the SRT stays available as a sidecar file.

## Example prompts

**Cinematic mystery Short**

> Make a 45-second 9:16 mystery short about a radio signal heard at 3:17 AM in a deserted railway station. Moody realistic night footage, restrained narration, rising tension, no graphic imagery, and an original ending. Include a hook in the first two seconds. Use footage or images with clear licenses.

**Educational explainer**

> Create a 60-second 16:9 explainer showing how solar panels turn sunlight into electricity. Keep the science accurate, distinguish verified facts from questions that need research, use clear visual analogies, and finish with a practical takeaway. Prefer natural stock footage and concise on-screen captions.

**Atmospheric image essay**

> Make a 30-second square visual essay about monsoon rain in an Indian city. Use cinematic stills with subtle slow zoom, match the palette between scenes, write original short narration, and leave a quiet beat at the end. Do not use unlicensed music.

**Reference-led, original treatment**

> Study the high-level pacing, shot variety and mood of this public reference link, then create three clearly different original directions for a 30-second vertical video about night trains. Do not reproduce its script, distinctive sequence, branding, or exact shots. Mark unavailable transcript/visual details as unknown.

## Local API

The visual board is the intended entry point. It uses these endpoints on the local server:

- GET /api/health — tool and optional provider readiness.
- GET /api/projects, POST /api/projects, GET /api/projects/:id — persistent project state.
- POST /api/projects/:id/plan, POST /api/projects/:id/reference/analyze, POST /api/projects/:id/research — planning, reference inspection and live search.
- POST /api/projects/:id/assets/search, POST /api/projects/:id/assets/import, POST /api/projects/:id/assets/upload — gather or import media.
- POST /api/projects/:id/voiceover, POST /api/projects/:id/captions — local speech and SRT.
- POST /api/projects/:id/approve, POST /api/projects/:id/render — explicit approval and MP4 render.
- GET /api/projects/:id/assets/:filename, GET /api/projects/:id/renders/:filename — project media and finished output.

Upload body limit is 120 MB per file. Project files are stored on disk, not encrypted. This standalone app is a local-only production workspace, not a multi-user web app.

## Current limits

- A reference URL analysis depends on yt-dlp support, the source site's availability and accessible subtitle tracks. The app reads metadata/available captions; it does not download the referenced full video by default.
- Local reference clips can be probed and sampled into a contact sheet. Visual frame analysis is only attempted if ULTRON_VISION_MODELS contains a suitable model and the OpenRouter key is configured. There is no scene-by-scene video transcription guarantee.
- The local fallback script/concepts are starter material, not research. Live research requires TAVILY_API_KEY.
- Motion and image assets are gathered from sources or uploaded. This branch does not yet include an AI video-generation model or a diffusion workflow. Music generation is not included; upload audio you have the right to use.
- Captions are generated from the scene script using scene-level timing. They are not forced-aligned to real speech.
- Render transitions are fades between/within clips and the image motion is a slow zoom; this is a practical local first version, not a nonlinear editor with arbitrary keyframes.
- The visual board refreshes from the local project JSON. It is not yet a distributed background queue or a feature exposed through the hosted ULTRON API.

## Verification

Run:

    npm run check
    npm test

The video-studio regression tests validate input safety, scene timing/caption helpers, local project persistence and approval gating. Media rendering requires FFmpeg, and remote research/provider behavior requires real network access and optional credentials.
