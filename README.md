# ZenithMax V28

ZenithMax V28 is the advanced social/video/creator build.

## V28 highlights
- Full authentication gate: the app opens on Login/Sign up when no session exists.
- Multi-step sign up: Username → Gmail + password → phone + optional profile picture → optional artist name.
- Account profile pictures, including signup upload and profile replacement.
- Optional Google Sign-In through Google Identity Services. Configure `GOOGLE_CLIENT_ID` in Render.
- Downloads library for Movies, Music, Shorts and Videos, with direct-download support where the media source permits it. Provider-hosted embeds remain subject to the provider's own download rules.
- Existing messaging, voice notes, groups and browser voice/video calling retained.
- Existing Shorts and long-form discovery systems retained and presented as ZenithMax-native experiences.

## Render environment
Keep your existing secrets. Optional Google Sign-In:

`GOOGLE_CLIENT_ID=<your Google OAuth web client id>`

Do not commit OAuth secrets or JWT/refresh secrets to GitHub.

## Important
ZenithMax uses original ZenithMax UI and integrations. It does not copy proprietary source code, protected branding, or private APIs from YouTube, WhatsApp, TikTok or Netflix. Those services are used only as product-pattern references; video/movie/media availability must respect each provider's permissions and licenses.
