# ZenithMax V14 — Smart Social Video Platform

ZenithMax V14 upgrades V12 into a more complete social-video launch candidate while keeping the 156 original demo videos included in the project.

## New in V14

- Smarter recommendation ranking with watch-category affinity, follows, saves, engagement and freshness.
- Recommendation reasons such as “Because you watch sports” and “From a creator you follow”.
- Search suggestions and category discovery.
- Full-screen Shorts with autoplay, swipe/touch navigation, desktop wheel navigation and sound controls.
- Proper watch page with progress tracking, comments, up-next recommendations and creator links.
- Real notification center for likes, follows, comments and messages.
- Direct-message conversations and chat UI.
- Playlists with add/remove video support and playlist playback collections.
- Creator profile editing and creator messaging.
- Creator Studio analytics: views, likes, followers, comments, top videos and category performance.
- Video reporting and an admin moderation overview for the first real registered account.
- Verified badges for starter creators.
- 156 original starter/demo videos across many safe general-audience categories.
- Responsive desktop/mobile layout and PWA manifest.

## Run locally

1. Install Node.js 18 or newer.
2. Open a terminal in this project folder.
3. Run `npm install`.
4. Set a strong `JWT_SECRET` environment variable for any public deployment.
5. Run `npm start`.
6. Open `http://localhost:3000`.

## Free Render deployment

The project listens on `0.0.0.0` and uses `process.env.PORT`, so it is hosting-friendly. Use `npm install` as the build command and `npm start` as the start command.

The starter video catalog uses remote HTTPS media URLs, so large demo MP4 files are not bundled in the repository. Runtime user uploads are stored in `DATA_DIR/uploads`. On hosts with ephemeral filesystems, runtime uploads can disappear after redeploys or restarts. For a real public platform, move uploads to object storage/CDN and move the JSON database to PostgreSQL.

## Production roadmap

For a much larger real-world service, add PostgreSQL, object storage/CDN, video transcoding and thumbnail jobs, email verification/password resets, stronger rate limiting, abuse detection, content moderation workflows, realtime WebSockets, push notifications, backups, audit logs and a dedicated live-video service.

Do not copy or rehost third-party social-media videos without permission. Use creator uploads, licensed content, or official authorized platform integrations.


## V14 — Creator Business Edition
V14 adds a creator-economy architecture: earnings dashboard, demo tips, demo subscriptions, ad campaign creation/activation, ad impression accounting, monetization eligibility, and an earnings ledger. **Demo mode only:** it does not process real money or collect card details. A production launch should integrate a compliant payment provider, database, tax/accounting workflows, fraud prevention, age/guardian requirements where applicable, and proper terms/privacy policies.


## V16.1 Launch Ready
- Non-empty starter feed with the bundled ZenithMax starter library.
- Creator onboarding with Become a Creator.
- Creator profiles, analytics and demo monetization retained.
- Chat supports text plus image, video and audio/music attachments.
- PWA install metadata and ZenithMax icon included.
- Media uploads use the configured filesystem; production should move media to durable object storage/CDN.
- Starter content is original demo content; do not upload or rehost copyrighted third-party videos without permission.


## Creator uploads V16.3
Users can upload: (1) videos in MP4/WebM/MOV, (2) music/audio in common formats, and (3) HTML5 games as ZIP packages containing an `index.html` entry point. Game ZIPs are unpacked into a static-only game directory and launched in a sandboxed iframe; server/executable file types are rejected. For production, use persistent object storage/CDN for uploaded media rather than the Render service filesystem.

## Developer credit
ZenithMax developer credit: **Zenith Oluwambe — Founder & CEO, ZenithMax Technology Company**.


## Free launch
This project is prepared for a Render Free Web Service: build `npm install`, start `npm start`, and no paid database is required for the demo launch. Free Render web services can sleep after inactivity and local uploaded files are not durable, so persistent media storage should be added later for a production service.
