# WildClaude App

Native client (Expo / React Native) for WildClaude servers — chat, voice, fleet,
dashboards, knowledge, agents. Designed to replace Telegram as the gateway.

See the full plan in [`../docs/MOBILE_APP_PLAN.md`](../docs/MOBILE_APP_PLAN.md).

## Status — Phase 0 (Foundations)

Done:
- Expo Router app shell, Nativewind (Tailwind), TanStack Query, Zustand, MMKV.
- **Modular architecture** — every feature is one entry in `src/features/manifest.ts`.
  Navigation, the Features settings screen and capability-gating all derive from it.
- **QR / manual pairing** (`app/pair.tsx`) — scan the QR from the web dashboard or enter
  `url + token`. Verified against `/api/info` before saving.
- **Fleet switcher** (`app/servers.tsx`) — multiple paired servers, switch the active one.
- **Capability gating** — `/api/info` now returns `role` + `capabilities`; features the
  server doesn't support are hidden and greyed out in Settings → Features.
- **Runtime feature toggles** (`src/store/features.ts`) — enable/disable per device, persisted.

Next (Phase 1): `/ws/chat` streaming gateway, native voice loop, Expo push notifications.

## Architecture

```
app/                 # expo-router routes (screens)
  _layout.tsx        # providers + active-server capability probe
  index.tsx          # gate → /pair or /home
  pair.tsx           # QR / manual pairing
  home.tsx           # module grid, derived from the manifest
  servers.tsx        # fleet switcher
  feature/[id].tsx   # generic feature host (swapped per phase)
src/
  features/manifest.ts  # ★ the modular core — one entry per feature
  api/client.ts         # typed client (Bearer + HMAC ticket for WS/SSE)
  store/servers.ts      # paired servers + active + server info
  store/features.ts     # runtime enable/disable
  lib/storage.ts        # MMKV
  lib/pair.ts           # QR payload parsing
  screens/              # screens too heavy for a route file
```

## Dev

```bash
cd app
npm install
npx expo start            # Expo Go via Tailscale, or
npx expo run:android      # dev client
```

Builds go through EAS (same org as WildNomads). Connect to a server over Tailscale
(real cert via `tailscale cert`) or pin a self-signed cert.

## Adding a feature

1. Add one entry to `src/features/manifest.ts` (`id`, `group`, `requiresServerCap`, `phase`).
2. Add a `case` in `app/feature/[id].tsx` (or a dedicated route) rendering the screen.

That's it — nav, settings toggle and gating update automatically.
