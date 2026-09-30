# ZenithMax V27 — Playback & Upload Repair

This build addresses the deployed V26.1 symptoms where Home, Discovery and Shorts could remain blank and uploads could appear stuck.

## Included repairs
- Async render errors are now caught so a failed auxiliary API call cannot leave the entire UI permanently on the loading screen.
- Home, Discovery and Shorts use safe fallbacks when one endpoint temporarily fails.
- Service-worker cache was bumped to V27 and the application shell uses network-first loading so an old V25/V26 JavaScript file is not silently reused after redeployment.
- Server shell assets are marked `Cache-Control: no-store`.
- JSON database writes use unique temporary filenames, preventing concurrent background media hydration and normal requests from colliding during `rename`.
- Resumable upload chunks were reduced from 4 MB to 2 MB to reduce proxy/request-size risk.
- Upload page now includes a **My uploads** section and refreshes it after a successful video upload.
- Existing licensed remote playback paths and upload storage integrations remain intact.

## Render
Keep the existing environment variables. Deploy this build from GitHub or replace the repository contents, then create a new deployment.

After deployment, open the ZenithMax URL in a new tab. The new service worker should replace the older shell automatically.

## Important media note
The web service can stream licensed remote media through ZenithMax and can use S3-compatible object storage for completed creator uploads. A free Render web service's local filesystem should not be treated as permanent media storage.
