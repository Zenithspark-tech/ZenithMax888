# ZenithMax V23

ZenithMax V23 is the production-hardening release following V24. It retains the expanded social/video/creator/communication experience and strengthens sessions, storage safety, service monitoring, and admin operations.

## V23 highlights
- Persistent login with refresh-token support and server-side session revocation.
- Atomic JSON database saves.
- API rate limiting and security response headers.
- `/api/health`, `/api/ready`, and `/api/meta` operational endpoints.
- Account security view and server logout.
- Audit logging for important account/admin actions.
- CEO/admin-only rolling database backups.
- Responsive interface and all previous V22.x features retained.

## Required production environment
- `JWT_SECRET`: strong random secret (32+ characters recommended).
- `REFRESH_SECRET`: a separate strong random secret is recommended.
- `DATA_DIR`: writable application data directory.
- `CEO_EMAILS`: comma-separated recognized executive account emails (the existing build defaults to the configured CEO account).
- `DEFAULT_COUNTRY_CODE`: default calling/contact country code when users enter local-format numbers.

## Remaining external services
For production scale, connect managed object storage/CDN, managed database storage, email/identity delivery, TURN/realtime infrastructure, and a real payment provider. The application includes the integration points and UI workflows but does not claim those third-party services are connected automatically.


## V24 Production Services
See `PRODUCTION_SERVICES_V24.md` for PostgreSQL, S3-compatible storage/CDN, transactional email, Stripe readiness, TURN, and FFmpeg configuration.
