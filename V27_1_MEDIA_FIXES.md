# ZenithMax V27.1 — Media Reliability

## What changed
- Home feed now surfaces four known-playable official YouTube embeds first, so the first screen does not depend on a background media resolver.
- Discover surfaces the same known-playable featured embeds first.
- Shorts page surfaces the known-playable featured embeds first, followed by the curated Commons Shorts catalog.
- Starter video records are migrated away from the previous blank remote-source catalog and refreshed from the current curated long-video list.
- Old non-Short demo starter records are removed during migration so stale blank starter entries do not dominate the feed.
- YouTube starters render through the official YouTube embed player rather than an HTML5 `<video>` tag pointed at a watch URL.
- Service-worker cache name bumped to V27.1 to prevent an old client shell from surviving deployment.

## Content/rights notes
- YouTube content is displayed through the official embedded player; ZenithMax does not download or re-host those videos.
- Curated Wikimedia entries retain their source/license metadata.
