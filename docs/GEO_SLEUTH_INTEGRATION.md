# ULTRON Geo-Sleuth integration

ULTRON integrates [Oldcircle/geo-sleuth](https://github.com/Oldcircle/geo-sleuth) as an optional, pinned Python photo-geolocation intake tool. Upstream source commit: `e01849f778afeb7c53ca79331313fbcfcb879486`. Upstream is MIT-licensed; the upstream data README documents separately licensed datasets.

## What is integrated

- Authenticated `GET /api/integrations/geo-sleuth/status` reports configuration only, not reachability.
- Authenticated `POST /api/integrations/geo-sleuth/intake` accepts a base64 JPEG, PNG, or WebP image up to 8 MB and runs the upstream `scripts/intake.py` in an isolated temporary workspace.
- Reverse-image search is disabled by default. Set `includeReverseSearch: true` only when the user has permission to analyze the image and agrees to use external reverse-image providers.
- The response returns `intake.md` evidence preparation only. It does not claim a location is solved; follow-up candidate-board, terrain, geometry and evidence commands are needed.

## Render configuration

The Render build clones the upstream repository at the pinned commit into `.runtime/geo-sleuth` and installs a pinned `uv` executable. The ULTRON service uses `GEO_SLEUTH_ENABLED=true` and `GEO_SLEUTH_ROOT=.runtime/geo-sleuth/skills/geo-sleuth`.

The pipeline is computationally heavy and may exceed free-instance resources or request timeouts. The endpoint has an eight-minute process cap and 8 MB upload cap. OCR/model features may require extra downloads and browser/system dependencies; an endpoint being enabled does not mean every upstream tool is healthy.

## Example

```http
POST /api/integrations/geo-sleuth/intake
Content-Type: application/json

{
  "imageBase64": "data:image/jpeg;base64,...",
  "includeReverseSearch": false
}
```

The endpoint requires ULTRON authentication. Do not use it to locate non-consenting people, private residences, or minors. Never report a coordinate/error radius unless the session contains actual computed and cross-checked evidence. Original upstream docs and license are available in the linked repository.
