# ZenithMax V27.3

Playback repair build based on the working V26.1 Express backend plus the V27.2 frontend. V27.3 specifically fixes the 2-second/blank starter-video regression by migrating old demo records to curated YouTube embeds.

The first Home/Discovery items do not depend on a background Wikimedia resolver.

.1

ZenithMax V26 is the discovery/personalization build following the V25 release candidate. It combines social publishing, Stories, Shorts, long-form video, music, games, creator tools, rankings, messaging/calls, responsive layouts, production-service adapters, and launch-readiness tooling.

## V26 additions
- For You / Following / Trending / Latest home-feed modes
- Interest-based personalization controls
- Continue Watching
- Not Interested content controls
- Autoplay and data saver preferences

## V25 additions
- Production Release Center with provider preflight checks
- Runtime request/error/latency metrics for administrators
- Safe schema upgrade backup before migrations
- Persistent access + refresh token storage and renewal
- Installable PWA shell with offline static fallback
- Release manifest and Render V25 configuration

## Production truth
Provider integrations are adapter-ready but are not considered live until real credentials and accounts are configured in Render.


## V26.1 Playback Fix
Home, Discovery and Shorts now have provider-aware playback. YouTube items use official embeds; Wikimedia Commons items use the server media proxy with byte-range support. Set `YOUTUBE_API_KEY` in Render to enable dynamic YouTube discovery.
