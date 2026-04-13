---
name: dashboard-management
description: Manage external service dashboards — add Vercel projects, Neon databases, custom APIs. Use when asked to "add dashboard", "create dashboard", "remove dashboard", "configure vercel", "add vercel project", "add neon database", "dashboard config".
---

# Dashboard Management

Create and manage external service dashboards. Dashboards connect to APIs (Vercel, Neon, Supabase, Stripe, etc.) and display live data on the web dashboard.

## Adding a Vercel Project Dashboard

1. Get the Vercel project ID from vercel.com > Project > Settings (starts with `prj_`)
2. Add to `~/.wild-claude-pi/config.json` under the `dashboards` array:

```json
{
  "id": "myapp-prod",
  "name": "My App PROD",
  "service": "vercel",
  "config": {
    "projectId": "prj_XXXXXXXXXXXX",
    "environment": "production",
    "branch": "main",
    "domain": "myapp.vercel.app"
  }
}
```

3. Ensure `VERCEL_TOKEN` is set: `/set_secret VERCEL_TOKEN`
4. The Vercel dashboard shows: deployment cards with status badges, build logs, domains, and environment variables.

For multiple environments, create separate entries with distinct IDs:
- `myapp-dev` (branch: dev, environment: development)
- `myapp-qa` (branch: qa, environment: qa)
- `myapp-prod` (branch: main, environment: production)

## Adding a Neon Database Dashboard

```json
{
  "id": "mydb-neon",
  "name": "My Database",
  "service": "neon",
  "config": {
    "projectId": "NEON_PROJECT_ID"
  }
}
```

Requires `NEON_API_KEY`. Shows project info, branches, and endpoints.

## Adding a Custom API Dashboard

For any REST API with Bearer/token auth:

```json
{
  "id": "my-api",
  "name": "My Custom API",
  "icon": "&#128300;",
  "secretKey": "MY_API_TOKEN",
  "baseUrl": "https://api.example.com/v1",
  "authHeader": "Bearer",
  "endpoints": [
    {"id": "health", "name": "Health Check", "path": "/health"},
    {"id": "metrics", "name": "Metrics", "path": "/metrics?limit=20"},
    {"id": "users", "name": "Users", "path": "/users?page=1&per_page=10"}
  ]
}
```

Auth options for `authHeader`:
- `"Bearer"` (default) — sends `Authorization: Bearer <token>`
- `"token"` — sends `Authorization: token <token>`
- `"Basic"` — sends `Authorization: Basic <base64(token)>`
- Custom template: `"X-API-Key: ${TOKEN}"` — replaces `${TOKEN}` with the actual key

## Config File Reference

Location: `~/.wild-claude-pi/config.json`

```json
{
  "dashboards": [
    { "id": "...", "name": "...", "service": "vercel", "config": { "projectId": "..." } },
    { "id": "...", "name": "...", "secretKey": "...", "baseUrl": "...", "endpoints": [...] }
  ],
  "preferences": { "theme": "dark", "language": "en" },
  "automations": [...]
}
```

## Removing a Dashboard

Remove the entry from the `dashboards` array in config.json. Built-in services (vercel, neon, supabase, stripe, cloudflare, github, sentry) cannot be removed — they are always available when their API key is set.

## Built-in Service Secret Keys

| Service | Secret Key | Where to get it |
|---------|-----------|----------------|
| Vercel | `VERCEL_TOKEN` | vercel.com > Settings > Tokens |
| Neon | `NEON_API_KEY` | console.neon.tech > Account > API Keys |
| Supabase | `SUPABASE_ACCESS_TOKEN` | supabase.com > Account > Access Tokens |
| Stripe | `STRIPE_SECRET_KEY` | dashboard.stripe.com > Developers > API Keys |
| Cloudflare | `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com > Profile > API Tokens |
| GitHub | `GITHUB_TOKEN` | github.com > Settings > Developer settings > PAT |
| Sentry | `SENTRY_AUTH_TOKEN` | sentry.io > Settings > Auth Tokens |
