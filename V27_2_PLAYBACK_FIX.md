# ZenithMax V27.2 — Playback Fix

## What changed
- The first feed no longer depends on Wikimedia runtime discovery.
- Curated feed videos are official YouTube embeds with verified current source pages.
- Home/Discovery cards render an embedded player for the curated YouTube items.
- Shorts uses the same curated embedded-player path and removes the old blank starter Shorts.
- Old starter media is cleaned during startup; user-created videos are not removed.
- Browser shell cache was bumped to V27.2.
- YouTube source links are kept as a visible fallback.

## Important
YouTube embeds require the video owner to allow embedding; when YouTube blocks an embed, the visible Watch on YouTube link remains available. YouTube's own help documentation notes that embedded playback depends on the embedding context/referer.
