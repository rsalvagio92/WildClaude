# WildClaude Mobile App — Plan

> Goal: a modern, fluid, production-ready Android (then iOS) app that is the **client** for
> WildClaude servers (primary + secondaries). Replaces Telegram as the conversation gateway,
> exposes every web-UI capability (dashboards, fleet, voice, knowledge, agents), and fixes the
> current conversational limits (one-shot replies, browser-only voice, self-signed cert friction).

## 1. Architecture at a glance

```
┌────────────────────────┐         HTTPS (valid cert via Tailscale)        ┌──────────────────────┐
│  WildClaude App (Expo)  │  ──────────────────────────────────────────▶   │  PRIMARY (WB1)        │
│  - Chat + Voice gateway │   REST  /api/* (107+ routes, Bearer token)      │  Hono :3141 + WS :3142│
│  - Fleet control        │   WS    /ws/chat  (streaming tokens + voice)    │  - all modules        │
│  - Dashboards viewer     │   SSE   /api/chat/stream (fallback)             │  - push dispatcher    │
│  - Knowledge / Agents   │   Push  Expo (FCM/APNs) ◀── proactive events    │  - device registry    │
└────────────────────────┘                                                  └──────────┬───────────┘
            │ can switch active server (fleet)                                          │ sync
            └────────────────────────────────────────────────────────────▶  SECONDARIES (WB2/WB3)
```

- **Server = source of truth.** App holds no business logic; it renders server state and streams.
- **Primary hosts the UI/API/push.** Secondaries reachable for direct control via the fleet API.
- **Reuse the public type surface** already exported in `src/sdk/index.ts` so the app's API client
  is typed against the server contract (no drift).

## 2. Tech stack (recommended)

| Concern | Choice | Why |
|---|---|---|
| Framework | **Expo SDK 54 + React Native + Expo Router** | User already runs Expo/EAS (WildNomads). Cross-platform, OTA updates. |
| Language | TypeScript | Shared types with server SDK. |
| Styling | **Nativewind (Tailwind in RN)** | Design parity with the web SPA (also Tailwind). |
| Data/cache | **TanStack Query** | Declarative fetch/cache/retry/offline for 100+ REST endpoints. |
| Client state | **Zustand** | Same store lib already used in WildNomads; tiny. |
| Realtime | **WebSocket** (`/ws/chat`) + `react-native-sse` fallback | Token streaming + voice; SSE as degraded path. |
| Audio | **expo-audio** (record + playback, background) | Native mic = better STT than browser Web Speech. |
| Push | **expo-notifications** (FCM + APNs) | Replaces Telegram proactive delivery. |
| Storage | **react-native-mmkv** | Fast secure local store (tokens, prefs, cache). |
| Motion | **Reanimated 3 + Gesture Handler** | Fluid transitions, hold-to-talk, sheets. |

**Native, not a WebView wrapper.** A WebView would ship fastest but fails the brief: native mic +
background audio + push + offline + fluidity need RN. We reuse the web *design language*, not its DOM.

## 3. The hard problems (and how the app fixes them)

### 3.1 Transport & certificate (today's #1 friction)
Self-signed HTTPS blocks the browser mic and is painful on mobile. Fix at the root:
- **Tailscale MagicDNS + `tailscale cert`** on the primary → a *real* Let's Encrypt cert for
  `wild-berry.<tailnet>.ts.net`. The app connects to a trusted HTTPS host from anywhere.
- Dashboard server already follows the scheme; point `DASHBOARD_HOST` at the MagicDNS name.
- Fallback for pure-LAN: **cert pinning** in the app (ship the self-signed fingerprint).

### 3.2 Pairing & auth
- **QR pairing:** web dashboard shows a QR encoding `{serverUrl, token}`; app scans → stores in MMKV.
  No typing tokens on a phone. Multiple servers = multiple paired profiles (fleet switcher).
- Reuse `DASHBOARD_TOKEN` Bearer + the existing HMAC **ticket** flow for WS/streaming auth.

### 3.3 Conversation (today: one-shot reply, goes silent on long tasks)
- New **`/ws/chat` gateway** (extend the existing ACP WS on `:3142`): streams `token`, `progress`,
  `tool`, `done` frames. Server already has `runAgent(..., onStreamText)` — wire it through.
- App renders tokens live AND speaks incrementally (sentence-chunked) → real conversation.
- **Voice loop:** native record → upload to `/api/voice/stt` (Groq Whisper, more accurate than the
  browser) → stream tokens → **streaming TTS** (`voice-streaming.ts` scaffold + ElevenLabs
  stream-input) → incremental playback with **barge-in** (already proven in the web Voice Chat).
- Keeps the spoken long-task ack, speed control, stop — promoted to native.

### 3.4 Replacing Telegram as gateway
Telegram does two jobs: (a) you→bot messages, (b) bot→you *proactive* pushes (08:00 briefing,
reflections, scheduled task results, skill/agent proposals, fleet alerts). The app must cover both:
- (a) handled by the chat WS.
- (b) **server push dispatcher:** a `notifyUser(event)` seam that currently calls Telegram gains an
  Expo-push backend. Device tokens stored in a new `push_devices` table. Proposals keep their
  inline-action buttons as native notification actions / in-app cards.
- **Transition:** keep Telegram live in parallel (dual-delivery) until the app is trusted, then flip
  a `GATEWAY=app|telegram|both` setting.

## 4. Feature parity map (20 web modules → app)

| App area | Covers web modules | Phase |
|---|---|---|
| **Talk** (Chat + Voice) | Command Center, Voice Chat | 1 |
| **Fleet** | Fleet Control, System Vitals, Node status | 2 |
| **Monitor** | Live Activity, Trace Inspector, Audit, Hermes Lab | 2 |
| **Knowledge** | Memory Palace, Wiki, Journal, Reflection & Digest | 3 |
| **Agents** | Agent Hub, Mission Control, Automation, Workflows, Evals | 3 |
| **Dashboards** | Declarative Dashboards (viewer → builder) | 4 |
| **Ecosystem** | Skills & MCP, Projects | 4 |
| **System** | Settings, Files, Personality, Secrets (status only) | 4 |

## 5. Server-side changes (kept small, additive, flagged)

1. `src/ws-chat.ts` — streaming chat gateway (reuse ACP WS server + `runAgent.onStreamText`).
2. `src/push/` — Expo push dispatcher + `push_devices` table + `/api/push/register`,
   `/api/push/prefs`. A `notifyUser()` seam wrapping the current Telegram sends.
3. `/api/voice/stt` — accept an uploaded audio blob, return Groq transcription (server-side STT).
4. `/api/pair` — issue/rotate a pairing payload for the QR flow.
5. Tailscale cert helper + docs; `DASHBOARD_HOST` = MagicDNS name.
6. CORS/origin allowance for the app where needed (native fetch is origin-less; WS needs token).

## 6. Phasing (each phase ships independently)

- **Phase 0 — Foundations:** Expo app skeleton (Expo Router, Nativewind, TanStack Query, MMKV),
  typed API client from `src/sdk`, QR pairing, Tailscale cert, fleet profile switcher, app health.
- **Phase 1 — Gateway (the core):** `/ws/chat` streaming, native voice loop, push notifications,
  proactive dual-delivery. This alone makes the app a viable Telegram replacement.
- **Phase 2 — Fleet & Monitoring:** machine list/status/control, vitals, activity, audit (read-heavy).
- **Phase 3 — Knowledge & Agents:** memory/wiki/journal, agent hub, missions, automations, workflows.
- **Phase 4 — Dashboards & full parity:** declarative dashboard viewer → builder/refine, settings.
- **Phase 5 — Production:** offline cache, deep links, error reporting, EAS Build → Play Internal →
  TestFlight; flip `GATEWAY=app`.

## 7. Repo & delivery

- **Location:** new sibling repo `wildclaude-mobile` (keeps the Pi-light server repo lean) OR `app/`
  inside this repo (versions lockstep with the API). Decision pending.
- **Types:** consume `src/sdk/index.ts` (publish as a small `@wildclaude/types` package or git submodule).
- **Builds:** EAS (already configured for the org); APK preview + Expo Go via Tailscale for dev,
  same flow as WildNomads.

## 8. Decisions (locked 2026-06-26)
1. **Repo:** `app/` inside this monorepo — versions lockstep with the API, types from `src/sdk`.
2. **Transport:** Tailscale real cert first, **with a self-signed option** retained (pinning) for
   pure-LAN / no-Tailscale setups. App supports both; server exposes which is active.
3. **Telegram:** stays fully working for now (dual-delivery). No cutover until explicitly chosen.

## 9. Modularity (core requirement)

Every feature must be independently enable/disable-able — both per-install and at runtime.

- **Manifest-driven:** a single `app/src/features/manifest.ts` lists every feature module
  (`{ id, title, icon, group, enabledByDefault, requiresServerCap }`). Navigation, screens, and
  push subscriptions are all derived from the manifest — adding/removing a feature is one entry.
- **Runtime toggles:** a Settings → Features screen flips features on/off; persisted in MMKV and
  (optionally) synced to the server per-device. Disabled features are not mounted, not fetched,
  not navigable — zero cost when off.
- **Server capability gating:** the app reads `GET /api/info` (server features/flags) and hides
  modules the connected server doesn't support (e.g. voice off if no ElevenLabs key, fleet off on
  a single-node install). Mirrors the existing `src/lib/config/features.ts` philosophy on web.
- **Lazy loading:** each feature is a lazily-imported route (like the web SPA's per-nav import) so a
  broken/disabled module never blocks app start.

## 10. Build approach
- Work on branch **`feat/mobile-app`** (server `master` stays safe; Telegram keeps running).
- **Phase 0 built directly** (greenfield scaffold + modular backbone — architecture-heavy).
- **Ralph loop** used for high-repetition parity work (esp. Phase 3's 9 modules) in a sandbox on
  the branch, with a per-phase `fix_plan.md` checklist. Never run Ralph with `local` sandbox against
  live `src/` while the server is up — server edits land via normal reviewed commits + safe-restart.
