# Fastrack CRM install notes

This is our fork (github.com/AONIQQ/crm) of trycompai/crm. Internal use only.

## Local dev
- One `.env` at repo root. Already configured: auth secret, sign-in allowlist (info@aoniqq.com, info@fastrack.school), local Docker Postgres.
- Missing (Andrew, ~2 min): Google OAuth client for sign-in and Gmail/Calendar sync.
  1. console.cloud.google.com/apis/credentials > Create credentials > OAuth client ID > Web application
  2. Redirect URI: http://localhost:3001/api/auth/callback/google
  3. Enable Gmail API + Calendar API on the project
  4. Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env (both, never just one)
- Ports are remapped because PracticeHQ owns 3000/5432 on this machine: app on
  http://localhost:3100, API on 3101, agent on 2000, Postgres on 5433.
- Run: `docker compose up -d && bun run dev` then open http://localhost:3100.
- OAuth redirect URI accordingly: http://localhost:3101/api/auth/callback/google

## Pulling upstream updates (the "auto-sync" question)
Updates are manual and on purpose. When upstream ships something we want:

    git fetch upstream && git merge upstream/main && git push

Or click "Sync fork" on the GitHub page of AONIQQ/crm. Deployment rebuilds from our
fork after that. Never build features directly on modified upstream files; keep our
changes to config, branding assets, and new files, and merges stay conflict-free.

## Production (LIVE as of 2026-08-06)
- App: https://crm.fastrack.school (Vercel project crm-app, root apps/app)
- API: https://crm-api.fastrack.school (Vercel project crm-api, root apps/api)
- DB: database `crm` on the existing Neon server (broad-butterfly-34402949), SEPARATE
  from `neondb` which holds the site's leads/colleges tables. NEVER point the CRM at
  `neondb`: prisma db push against it tries to DROP the site's tables (it refused once
  already; do not ever pass --accept-data-loss).
- crm-api buildCommand runs `prisma migrate deploy` before build, so upstream
  migrations apply automatically on each deploy after a fork sync.
- Deploys are CLI-based from this folder (no GitHub auto-deploy):
  `VERCEL_ORG_ID=team_dZQibfVEGgwzpQGobXROKbyB VERCEL_PROJECT_ID=<id> vercel deploy --prod --yes`
  (project IDs in Vercel dashboard; run once for apps/api's project, once for apps/app's)
- Agent service is NOT yet hosted in production (needs a long-running host; the app
  works without it, minus the Agent tab). Candidates: Railway/Fly, or keep it local.
- Google OAuth callback for production: https://crm-api.fastrack.school/api/auth/callback/google
  must be in the OAuth client's redirect URIs (plus the localhost:3101 one for dev).
- AUTH_COOKIE_DOMAIN=fastrack.school is set so one session cookie covers both subdomains.
