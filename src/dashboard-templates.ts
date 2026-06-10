/**
 * Built-in dashboard templates — ready-to-use specs for the declarative
 * dashboard engine (dashboards-v2.ts). Each is a plain spec fragment
 * (no id/timestamps); `instantiateTemplate` normalizes + persists a copy.
 *
 * Sources use PUBLIC, key-less HTTPS APIs wherever possible so they work
 * out of the box. Where a key is genuinely required, a {{SECRET_NAME}}
 * placeholder is used and the user wires the secret via /set_secret.
 */

import type { DashboardSpec } from './dashboards-v2.js';

// Templates carry a stable id for lookup but no timestamps (assigned on instantiate).
type Template = Omit<DashboardSpec, 'createdAt' | 'updatedAt'>;

export const DEFAULT_DASHBOARD_TEMPLATES: Template[] = [
  // ── Finance / Crypto / Market ──────────────────────────────────────
  {
    id: 'markets-crypto',
    title: 'Markets & Crypto',
    icon: '📈',
    description: 'Live crypto prices, FX rates, and market movers — public APIs, no keys.',
    widgets: [
      {
        id: 'btc',
        type: 'metric',
        title: 'Bitcoin (USD)',
        w: 3,
        source: { kind: 'http', url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', jsonPath: 'bitcoin.usd' },
        config: { unit: '$', format: 'currency' },
        refreshSec: 60,
      },
      {
        id: 'eth',
        type: 'metric',
        title: 'Ethereum (USD)',
        w: 3,
        source: { kind: 'http', url: 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', jsonPath: 'ethereum.usd' },
        config: { unit: '$', format: 'currency' },
        refreshSec: 60,
      },
      {
        id: 'eurusd',
        type: 'metric',
        title: 'EUR → USD',
        w: 3,
        source: { kind: 'http', url: 'https://api.frankfurter.app/latest?from=EUR&to=USD', jsonPath: 'rates.USD' },
        config: { format: 'number', decimals: 4 },
        refreshSec: 3600,
      },
      {
        id: 'eurgbp',
        type: 'metric',
        title: 'EUR → GBP',
        w: 3,
        source: { kind: 'http', url: 'https://api.frankfurter.app/latest?from=EUR&to=GBP', jsonPath: 'rates.GBP' },
        config: { format: 'number', decimals: 4 },
        refreshSec: 3600,
      },
      {
        id: 'top-coins',
        type: 'table',
        title: 'Top coins by market cap',
        w: 12,
        source: {
          kind: 'http',
          url: 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false',
        },
        config: {
          columns: [
            { key: 'name', label: 'Coin' },
            { key: 'current_price', label: 'Price', format: 'currency' },
            { key: 'price_change_percentage_24h', label: '24h %', format: 'percent' },
            { key: 'market_cap', label: 'Market cap', format: 'compact' },
          ],
        },
        refreshSec: 120,
      },
      {
        id: 'market-news',
        type: 'feed',
        title: 'Market headlines',
        w: 12,
        source: { kind: 'rss', url: 'https://www.investing.com/rss/news_25.rss', limit: 10 },
      },
    ],
  },

  // ── Fitness + Nutrition tracker ────────────────────────────────────
  {
    id: 'fitness-nutrition',
    title: 'Fitness & Nutrition',
    icon: '💪',
    description: 'Log workouts, weight, and meals — charts update as you record entries.',
    widgets: [
      {
        id: 'log-weight',
        type: 'form',
        title: 'Log weight',
        w: 4,
        source: { kind: 'local' },
        config: { fields: [{ name: 'weight', label: 'Weight (kg)', type: 'number' }], submitLabel: 'Log' },
      },
      {
        id: 'log-meal',
        type: 'form',
        title: 'Log meal',
        w: 4,
        source: { kind: 'local' },
        config: {
          fields: [
            { name: 'meal', label: 'Meal', type: 'text' },
            { name: 'calories', label: 'Calories', type: 'number' },
            { name: 'protein', label: 'Protein (g)', type: 'number' },
          ],
          submitLabel: 'Log',
        },
      },
      {
        id: 'log-workout',
        type: 'form',
        title: 'Log workout',
        w: 4,
        source: { kind: 'local' },
        config: {
          fields: [
            { name: 'activity', label: 'Activity', type: 'text' },
            { name: 'minutes', label: 'Minutes', type: 'number' },
          ],
          submitLabel: 'Log',
        },
      },
      {
        id: 'weight-trend',
        type: 'chart',
        title: 'Weight trend (30d)',
        w: 8,
        source: { kind: 'local', field: 'weight', agg: 'avg', groupByDay: true, sinceDays: 30 },
        // local 'log-weight' rows are read here — wire reads to the form widget id
        config: { kind: 'line', x: 'day', y: 'value', readWidget: 'log-weight' },
      },
      {
        id: 'latest-weight',
        type: 'metric',
        title: 'Latest weight',
        w: 4,
        source: { kind: 'local', field: 'weight', agg: 'last' },
        config: { unit: 'kg', readWidget: 'log-weight' },
      },
      {
        id: 'calories-today',
        type: 'metric',
        title: 'Calories today',
        w: 4,
        source: { kind: 'local', field: 'calories', agg: 'sum', sinceDays: 1 },
        config: { unit: 'kcal', readWidget: 'log-meal' },
      },
      {
        id: 'protein-today',
        type: 'metric',
        title: 'Protein today',
        w: 4,
        source: { kind: 'local', field: 'protein', agg: 'sum', sinceDays: 1 },
        config: { unit: 'g', readWidget: 'log-meal' },
      },
      {
        id: 'calories-trend',
        type: 'metric',
        title: 'Calories vs last week',
        w: 4,
        source: { kind: 'local', field: 'calories', agg: 'delta', sinceDays: 7 },
        config: { unit: 'kcal', readWidget: 'log-meal' },
      },
      {
        id: 'active-goal',
        type: 'gauge',
        title: 'Active minutes (7d goal)',
        w: 4,
        source: { kind: 'local', field: 'minutes', agg: 'sum', sinceDays: 7 },
        config: { unit: 'min', target: 150, readWidget: 'log-workout' },
      },
      {
        id: 'workout-streak',
        type: 'metric',
        title: 'Workout streak',
        w: 4,
        source: { kind: 'local', agg: 'streak' },
        config: { unit: 'days', readWidget: 'log-workout' },
      },
      {
        id: 'recent-meals',
        type: 'table',
        title: 'Recent meals',
        w: 8,
        source: { kind: 'local', sinceDays: 7 },
        config: { columns: [{ key: 'meal', label: 'Meal' }, { key: 'calories', label: 'Cal' }, { key: 'protein', label: 'Protein' }], readWidget: 'log-meal' },
      },
      {
        id: 'fitness-insight',
        type: 'insight',
        title: 'AI insight',
        w: 4,
        config: { readWidget: 'log-weight' },
      },
    ],
  },

  // ── News ───────────────────────────────────────────────────────────
  {
    id: 'news-briefing',
    title: 'News Briefing',
    icon: '📰',
    description: 'Top headlines across world, tech, and business — public RSS feeds.',
    widgets: [
      {
        id: 'world',
        type: 'feed',
        title: 'World — BBC',
        w: 6,
        source: { kind: 'rss', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', limit: 10 },
      },
      {
        id: 'tech',
        type: 'feed',
        title: 'Tech — Ars Technica',
        w: 6,
        source: { kind: 'rss', url: 'https://feeds.arstechnica.com/arstechnica/index', limit: 10 },
      },
      {
        id: 'business',
        type: 'feed',
        title: 'Business — Reuters',
        w: 6,
        source: { kind: 'rss', url: 'https://www.investing.com/rss/news_285.rss', limit: 10 },
      },
      {
        id: 'hn',
        type: 'feed',
        title: 'Hacker News front page',
        w: 6,
        source: { kind: 'rss', url: 'https://hnrss.org/frontpage', limit: 10 },
      },
    ],
  },

  // ── Connected Services (dev) ───────────────────────────────────────
  // Pulls live data from your service APIs via the engine's http source.
  // Set the named secrets in Settings → Secrets; widgets fill in once present.
  {
    id: 'connected-services',
    title: 'Connected Services',
    icon: '🔌',
    description: 'Live status from GitHub & Vercel via your API tokens. Set the secrets below to activate.',
    widgets: [
      {
        id: 'setup-note',
        type: 'note',
        title: 'Setup',
        w: 12,
        config: { markdown: 'Set these in Settings → Secrets, then refresh:\n• GITHUB_TOKEN — a GitHub personal access token (repo + notifications scope)\n• VERCEL_TOKEN — a Vercel access token\n\nWidgets below call those APIs server-side; your tokens never reach the browser.' },
      },
      {
        id: 'github-repos',
        type: 'table',
        title: 'GitHub — recently updated repos',
        w: 12,
        source: {
          kind: 'http',
          url: 'https://api.github.com/user/repos?sort=updated&per_page=10',
          headers: { Authorization: 'Bearer {{GITHUB_TOKEN}}', 'User-Agent': 'WildClaude', Accept: 'application/vnd.github+json' },
        },
        config: {
          columns: [
            { key: 'full_name', label: 'Repo' },
            { key: 'updated_at', label: 'Updated' },
            { key: 'stargazers_count', label: '★' },
            { key: 'open_issues_count', label: 'Issues' },
          ],
        },
        refreshSec: 300,
      },
      {
        id: 'vercel-deploys',
        type: 'table',
        title: 'Vercel — recent deployments',
        w: 12,
        source: {
          kind: 'http',
          url: 'https://api.vercel.com/v6/deployments?limit=10',
          headers: { Authorization: 'Bearer {{VERCEL_TOKEN}}' },
          jsonPath: 'deployments',
        },
        config: {
          columns: [
            { key: 'name', label: 'Project' },
            { key: 'state', label: 'State' },
            { key: 'url', label: 'URL' },
          ],
        },
        refreshSec: 120,
      },
    ],
  },
];
