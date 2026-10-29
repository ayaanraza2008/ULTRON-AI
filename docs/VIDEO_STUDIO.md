# ULTRON Video Studio

Video Studio is an integrated workspace served by ULTRON at **/studio**. It is deliberately local-first: project JSON, uploaded files, stock downloads, caption sidecars, and renders are stored in a local workspace directory. It does not install large local AI models or call paid media-generation tools automatically.

## Run locally

Requirements:
- Node.js 20 or newer and the repository's existing npm dependencies.
- FFmpeg and FFprobe on your system PATH for media inspection/rendering.
- Optional yt-dlp for limited reference-link metadata extraction in local mode.
- Optional model, research, stock-media and voiceover API keys.

~~~bash
npm install
# Copy .env.example to .env, then privately configure only the APIs you use.
npm run studio:local
~~~

Open http://127.0.0.1:10000/studio. The launcher binds only to loopback. It loads variables from .env without overwriting environment variables that were already set. ULTRON_VIDEO_STUDIO_LOCAL_MODE=true is used by the launcher unless the caller explicitly sets another value. Do not use local unauthenticated mode on a host reachable from a LAN or the public internet.

Project data defaults to .local/video-studio/; override it with ULTRON_VIDEO_STUDIO_DIR. Do not commit .env or project assets.

## Example prompts

**Cinematic mystery Short**
> Make a 45-second 9:16 cinematic mystery in English about a deserted railway platform where the station clock loses exactly 17 minutes. Start slowly, escalate through shorter shots, keep the same platform, red signal lamp and clock design across scenes, use an original narration, and end with an unsettling visual payoff.

**Nature short with real motion footage**
> Create a 30-second 9:16 nature Short about rain forming on a fern in a forest. Prefer authentic motion footage, gentle natural ambience, three distinct concepts, short factual narration that requires source verification, and no unsupported claims about the species.

**Documentary/reference-assisted**
> Make a 3-minute 16:9 mini-documentary about how urban heat islands form. Research sources first, mark every factual claim for review, suggest licensed stock footage, keep a source/creator list for each imported item, and estimate the cost before any final render.

**Reference clip**
> Analyze this reference's pacing and scene-change pattern without copying its dialogue or visual expression. Use my pasted transcript only as reference evidence. Return three original concepts in the same broad mood, then draft a new script and scene timeline.

## Workflow

1. **Brief and reference.** Write a plain-English brief and optionally add a YouTube, TikTok, Instagram/Reel, Vimeo, or local clip reference.
2. **Analyze.** A local uploaded clip can be inspected with FFprobe and FFmpeg for duration, dimensions, frame rate, audio presence and scene-change timestamps. When FFmpeg emits signal statistics, the board also summarizes sampled-frame brightness, contrast and saturation as objective visual cues, not semantic vision or subject recognition. If VoiceStudio or an OpenAI-compatible STT endpoint is configured, choose **Transcribe local clip** to extract up to 210 seconds of audio locally and request a transcript. Otherwise paste a transcript manually. A URL is only limited metadata unless a supported local extractor is available.
3. **Plan.** ULTRON tries its configured server-side model providers and falls back to a local template if no usable provider is configured. Review three directions, script, timed scenes, transitions, continuity, and tasks.
4. **Research.** Configure TAVILY_API_KEY to enable live research. Otherwise the board records that research was not run. Always verify important claims against primary sources.
5. **Gather assets.** Upload local media or search optional stock libraries with PEXELS_API_KEY and/or PIXABAY_API_KEY. Asset records keep the provider, title, source page and contributor when available. Read the actual licence and any attribution requirements before publishing.
6. **Audio/captions.** Voiceover uses the existing VoiceStudio or compatible TTS configuration. Captions are drafted as an SRT sidecar from scene narration. Timing/spelling remain editorial review tasks.
7. **Approve.** Approve the plan, import visual assets, review the budget/credits, and explicitly approve the final render. Changing the script resets plan and render approvals.
8. **Render.** FFmpeg creates an MP4 locally. Still images get a slow zoom/pan motion treatment; motion assets are resized/cropped into segments, then gentle crossfades are applied between scenes with a hard-cut fallback if the filter is unavailable. Available voiceover/music tracks are mixed. Render progress and activity are recorded on the board.

## Environment variables

| Variable | Purpose |
|---|---|
| ULTRON_VIDEO_STUDIO_DIR | Project and media storage path (default .local/video-studio/) |
| ULTRON_VIDEO_STUDIO_LOCAL_MODE | Loopback-only no-login mode. The local launcher defaults it to true; keep false on hosted deployments. |
| OPENROUTER_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, ULTRON_MODEL_PROVIDERS_JSON | Optional model providers for production concepts and scripts |
| TAVILY_API_KEY | Enables web research |
| PEXELS_API_KEY, PIXABAY_API_KEY | Enable stock-video and still-image search |
| VOICESTUDIO_BASE_URL, VOICESTUDIO_API_KEY | VoiceStudio TTS and transcription endpoint. On the same PC, local mode can call http://localhost:3900. |
| STT_API_BASE_URL, STT_API_KEY, STT_MODEL | OpenAI-compatible STT base URL (usually ending in /v1), key, and model when VoiceStudio isn't used |
| TTS_API_BASE_URL, TTS_API_KEY, TTS_MODEL, TTS_DEFAULT_VOICE | Compatible OpenAI-style speech endpoint when VoiceStudio is not used |
| ULTRON_STUDIO_AI_COST_PER_1K_TOKENS_USD | Optional configured unit rate used to estimate AI cost |
| ULTRON_STUDIO_TTS_COST_PER_1K_CHARS_USD | Optional configured unit rate used to estimate TTS cost |

Leave unknown pricing blank. The displayed total stays marked as partial unless both AI and TTS unit rates are provided. The calculation is an estimate—not a provider quote or a guaranteed invoice prediction.

## Local tools

- FFmpeg downloads and installation: https://ffmpeg.org/download.html
- yt-dlp project and installation instructions: https://github.com/yt-dlp/yt-dlp
- Pexels API docs: https://www.pexels.com/api/documentation/
- Pixabay API docs: https://pixabay.com/api/docs/
- Google Gemini API key: https://aistudio.google.com/apikey
- Groq API key: https://console.groq.com/keys

Only configure third-party services you accept for the content you send them. A key's presence does not prove that access, quota, or a service's license/terms allow a given use.

## Limits and honest verification

- UI file uploads are capped at 8 MB per file to fit the existing bounded JSON API request. Stock imports are capped at 40 MB.
- A URL is not the same as full reference video access. Platform restrictions can prevent metadata retrieval. The app never fabricates a transcript or claims that URL-only metadata provides measured scene cuts. Automatic transcription only applies to an uploaded local clip with a configured STT/VoiceStudio endpoint and is capped at 210 seconds/7 MB extracted audio.
- Local yt-dlp use is only invoked in local mode and after the user checks that they have rights/permission. It requests metadata only; it does not download the reference movie.
- The media tools do not automatically generate new video footage, AI images, or music. The pipeline uses stock or local media and still-image motion. New image/video generation adapters can be connected later, when their APIs, cost controls and license terms are known.
- The SRT captions file is not burned into the final MP4. Review caption timing and text in an editor if you need hard subtitles.
- Local CPU rendering is free in API usage but uses your machine's time and resources. Hosted local-disk project data can be ephemeral if the host does not have persistent storage; use the local launcher for durable local assets or configure a persistent data volume.
- The current cost ledger records estimated configured unit rates and the local FFmpeg render's zero API charge. Some APIs do not expose actual billed cost, so unknown third-party costs are not invented.
- The board's status and test results must not be read as proof that real providers, account access, media licences, the audio device, or an actual render have succeeded. Run an end-to-end render with sample media before relying on it for production.

For current implementation coverage and outstanding verification, see DEVELOPMENT_STATE.md.


## Licensing note

The existing ULTRON repository currently has no top-level LICENSE file. This integration does not silently apply a license to the entire existing codebase. Public repository visibility is not itself an open-source license; the repository owner should choose and add a project license before advertising the integrated project for reuse or redistribution.
