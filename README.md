# ZenithMax V20.4 — scalable 567K remote Shorts catalog

V20.4 upgrades the Shorts system from a runtime cache into an **append-only, exactly de-duplicated catalog** designed to grow toward 567,000 unique remote videos without bundling the media files.

## What changed

- Exact SHA-256 URL de-duplication; the catalog no longer relies on a Bloom filter alone.
- Append-only NDJSON shards (`10,000` records per shard) keep individual catalog files small enough for source control.
- Byte-offset indexes allow page reads without loading the whole catalog into memory.
- Related categories and topic/query variants continue to discover different kinds of real-world videos.
- Existing curated Shorts are excluded from the remote catalog's page results while their source URLs are marked as already seen.
- Admin-only **Grow Shorts Catalog** controls can attempt to add 100 or 500 unique remote Shorts.
- `scripts/discover_shorts.js` supports command-line ingestion for larger batches.
- A GitHub Actions workflow (`.github/workflows/grow-shorts.yml`) can run weekly or manually to grow the catalog and commit the catalog shards/state.
- Client-side infinite scrolling still loads only the current page of videos.
- Remote videos remain streamed through the ZenithMax media proxy; no MP4/WebM files are stored in the ZIP.

## Important about 567,000

`567,000` is the platform's catalog capacity/goal. V20.4 does **not** claim that 567,000 unique videos have already been collected. The ingestion worker adds only remote files it can discover and verify from the supported source and skips duplicates.

## Running the catalog grow script

```bash
node scripts/discover_shorts.js --count=500 --category=ALL
node scripts/discover_shorts.js --count=250 --category=FOOTBALL
```

For an actual 567,000-entry library, keep growing the catalog in batches. The exact final count depends on the source's available video inventory and licensing.

## Render free

The web service remains configured for Render's Free plan. Runtime catalog files and user uploads still use the service filesystem; the GitHub workflow provides an optional way to keep the Shorts catalog in the repository so a new Render instance can rebuild from committed catalog shards. User-uploaded media should still move to persistent object storage before production scale.


## V20.4.1 deployment fix
The server now starts listening immediately; remote media catalog hydration runs in the background with an 8-second API timeout. This prevents Render health checks from being blocked by remote media lookups.


## V20.4.2 deployment fix
The previous V20.4.1 package referenced `server/shorts_catalog.json` while the catalog was stored at repository root. V20.4.2 uses the server copy when present and safely falls back to the root catalog. This fixes the Render `ENOENT ... server/shorts_catalog.json` startup failure.

## V20.4.3 Shorts fix
- Categories are hidden from the Shorts UI but remain in metadata for recommendations/search.
- Starter Shorts use direct Wikimedia Commons media URLs and the player falls back to the direct URL if the ZenithMax proxy fails.
- Page 1 serves the curated starter Shorts immediately instead of waiting for remote catalog discovery.


### Starter Shorts
The Shorts library now contains 123 starter entries. The first curated entries have direct remote media; additional entries resolve unique openly licensed remote video sources on demand so the app does not bundle large media files.


## V20.5 Home video and search upgrade
- Home keeps the existing 156 starter video topics and now hydrates a separate remote Home library in the background.
- Search now falls back to live Wikimedia Commons media search when local results are sparse, returning real remote videos related to the query and related terms.
- Remote search results are deduplicated, cached, playable through a Range-aware ZenithMax proxy, and retain license/source metadata.
- Only Commons files with CC0/public-domain/CC BY/CC BY-SA-style labels are accepted by the remote media filter; reusers still need to verify each file's license and satisfy any attribution conditions.


## V21 Communication
- Phone-number discovery for ZenithMax contacts.
- Direct and group text chat.
- Voice notes recorded in the browser with MediaRecorder.
- Image/video/audio attachments.
- One-to-one and group internet voice/video calls using WebRTC + REST polling signaling.
- The call system is browser-to-browser internet calling; it is not a cellular/PSTN phone service.
- Production-grade calling at scale will eventually need TURN servers, durable realtime signaling, rate limits and moderation.
