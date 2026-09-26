# ZenithMax V20 — scalable 567K remote Shorts catalog

V20 upgrades the Shorts system from a runtime cache into an **append-only, exactly de-duplicated catalog** designed to grow toward 567,000 unique remote videos without bundling the media files.

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

`567,000` is the platform's catalog capacity/goal. V20 does **not** claim that 567,000 unique videos have already been collected. The ingestion worker adds only remote files it can discover and verify from the supported source and skips duplicates.

## Running the catalog grow script

```bash
node scripts/discover_shorts.js --count=500 --category=ALL
node scripts/discover_shorts.js --count=250 --category=FOOTBALL
```

For an actual 567,000-entry library, keep growing the catalog in batches. The exact final count depends on the source's available video inventory and licensing.

## Render free

The web service remains configured for Render's Free plan. Runtime catalog files and user uploads still use the service filesystem; the GitHub workflow provides an optional way to keep the Shorts catalog in the repository so a new Render instance can rebuild from committed catalog shards. User-uploaded media should still move to persistent object storage before production scale.
