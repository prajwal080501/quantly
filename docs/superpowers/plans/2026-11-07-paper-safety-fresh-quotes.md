# Paper safety and fresh quotes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Use only fresh provider quotes for paper fills and new entries, and enforce the existing risk settings coherently, without changing signal formulas or enabling disabled setups.

**Architecture:** Quote freshness is a pure check on upstream timestamps (`ltt`, else feed `currentTs`). The paper engine never reads a stale cache and never falls back to the mock feed when Upstox fails. Cash truth is the sum of unique `CashPosting` documents (one insert is atomic on standalone Mongo). Position, order, and trade writes are absolute and idempotent under a `fillKey`. Replica-set multi-document transactions are not used, because the deployed `MONGO_URI` is standalone `127.0.0.1` without `replicaSet`. Square-off retries failed symbols on later scheduler ticks and will not book a second exit for the same position and day.

**Tech Stack:** Node 20+, Express 5, Mongoose, existing Upstox market-data feed, React client.

## Global Constraints

- Real execution stays paper-only. Live means market data.
- Do not change scanner setups, indicator periods, thresholds, entry/exit pattern conditions, news rules, combinations, or strategy parameters. Do not enable Level retest or VWAP pullback (`ALWAYS_OFF` stays).
- Do not change reset semantics: reset deletes paper history and returns both balances to configured `STARTING_BALANCE`.
- Do not invent NSE holiday dates. Empty `NSE_HOLIDAYS` stays empty and is reported as unconfigured.
- Do not read or commit `server/.env`. No production access, merge, or deploy.
- Risk numbers stay the configured ones (`TradeDefaults` rupee stop, `AutoSettings.maxOpen` / `dailyLossPct`, `OptionSettings` equivalents, `MIS_LEVERAGE`). Orders may be rejected or, for auto only, reduced in size.
- A TTL that still returns the old last price is not acceptable. An old exchange timestamp is stale even if the packet just arrived.
- Mock quotes are executable only when the configured provider is the mock.

## Behavior changes to document (not identical trades)

- New entries and protective paper fills require a fresh upstream timestamp. Missing, stale, future, or out-of-order quotes reject the entry or leave the exit pending.
- Auto quantity can be smaller so gross stop distance plus estimated round-trip charges fit the existing rupee stop. Manual orders that do not fit are rejected, not silently resized.
- Manual and auto openings share `maxOpen`, the daily loss percent (realised and open losses, plus the new trade’s planned risk), and a book cap of `per-trade rupee stop × maxOpen`.
- Auto will not add to a symbol it already holds. A second manual order may still add. Retries with the same `clientOrderId` return the first order.
- Stops can still lose more than the rupee figure if the fresh print gaps through the trigger. That residual gap risk is not removed.
- Reset still discards top-ups. The response states the configured balance it restored.

## Files

- `server/src/market/quoteFreshness.js` — pure freshness rules.
- `server/src/market/providers/upstox/UpstoxProvider.js` — no invented `Date.now()` timestamp; REST quote fetch with dedupe, timeout, 429 retry.
- `server/src/market/MarketDataService.js` — executable quote vs display snapshot; no mock fallback.
- `server/src/services/fillLedger.js`, `server/src/models/CashPosting.js` — idempotent cash and fill application.
- `server/src/services/riskGate.js` — shared limits.
- `server/src/services/orderEngine.js` — fresh quotes, risk gate, fill keys, square-off retry.
- `server/src/auto/autoTrader.js` — stable idempotency key; skip when the quote is not fresh.
- `server/src/routes/upstox.js`, `server/src/services/upstoxAuth.js` — operator allow-list; mode `0600` on newly written env files.
- `server/src/config/env.js`, `server/src/app.js` — operator list, holiday status, `inflate: false`.
- `client/src/lib/useApi.js`, `client/src/pages/Dashboard.jsx`, `client/src/components/MarketStatus.jsx`, `client/src/components/LivePrice.jsx` — segment fetch isolation and freshness display.
- `server/package.json` / lockfile — `body-parser@2.4.0`.
- `.github/workflows/test.yml` — server tests plus client test and build.
- Tests and `server/test/fixtures/signal-baseline.json`.

## Tasks

- [ ] Lock signal baseline. Do not edit scanner, indicator, setup, or news modules.
- [ ] Red/green freshness: old `ltt` rejected; repeated equal timestamps allowed; missing timestamp rejected; mock not used when provider is Upstox.
- [ ] Red/green ledger: duplicate key does not double cash; repair after a missed balance write; reset still returns configured balance.
- [ ] Red/green risk and same-symbol auto race.
- [ ] Red/green square-off: failed symbol retries; second success does not double-exit.
- [ ] Dashboard path change clears data; error is visible.
- [ ] Operator-only Upstox session; token write mode `0600`; no token in logs.
- [ ] Holiday status when `NSE_HOLIDAYS` is empty; a configured date still closes that day.
- [ ] Dependency override and CI workflow.
- [ ] Full server tests, client tests, production build.

## Rollout

Verified target, not assumed: Mongo 7 container `trading-helper-mongo` on `127.0.0.1:27017`, `db.hello().setName === null`, URI has no `replicaSet`. This design does not use multi-document transactions. The first `getFunds` after upgrade inserts one `opening:<userId>` cash posting equal to `balance - startingBalance` when no postings exist, so the existing cash figure is kept. Orders, positions, and trades are not deleted. Do not convert the standalone node to a replica set and do not wipe `trading-helper-mongo-data`.

Host is linux arm64, Node v22.23.4, npm 10.9.9, about 904 MiB RAM. App root `/opt/trading-helper`, systemd `trading-helper.service` runs `/usr/bin/node src/index.js` in `server/`. Env stays `/opt/trading-helper/server/.env` mode 600. Do not replace that file with a template. Add `UPSTOX_OPERATOR_EMAILS` and `RELEASE_SHA` beside the existing keys. nginx already terminates TLS and proxies to `127.0.0.1:5000`. Leave `/opt/sthir` and any other EC2 alone.

The process serves `phone-app/` before `client/dist`. Copy the prebuilt frontend archive over `phone-app/` so the arm64 host does not run Vite. Production dependencies have no native addons (`bcryptjs`, not `bcrypt`). `npm ci --omit=dev` on the host is still required for `node_modules`.

Saturday cannot prove a fresh intraday Upstox trade print. `/api/market/status` should show `market.phase` `WEEKEND` and `feed.auth` `ok` or `expired`. An expired token is a real status, not a failed deploy.
