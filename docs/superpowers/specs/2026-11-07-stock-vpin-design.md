# Display-only stock VPIN

**Status:** Approved design, written for review before any implementation plan. This document does not authorize feature code, a trading-rule change, or a deploy.

**Base:** `15f9af04be63bd9b02dbe4c23275dbdf984c93a6` on `cursor/paper-safety-fresh-quotes-1d33`. Later work starts from this commit, not from old `main`.

**Goal:** Show an honest Bulk Volume Classification estimate of volume-synchronized probability of informed trading on the existing stock detail screen. The number is observational. It does not place, block, size, or exit a paper order.

## Decisions

- Scope is the Nifty 50 constituents in `isTradable` (`server/src/market/instruments.js`). Each stock uses its own candle volume.
- Nifty 50 and Nifty Bank are indexes. `IndexFullFeed` has no `vtt`. The API returns `unsupported` and `value: null`. No futures proxy, no option-volume proxy, and no equal-weight basket.
- Options are out of scope. An option symbol is not a stock and is rejected as an unknown symbol.
- Order-book fields `tbq`, `tsq`, and depth quantities are never volume.
- `ltq` is last-trade size, not a full tape, and this design does not use it. Classification is one-minute candle BVC only.
- The screen copy and the field names must not present VPIN as a buy or a sell.
- No new database collection, vendor, environment variable, or background job.

## What the data is

Upstox full mode is already the subscription (`server/src/market/providers/upstox/UpstoxProvider.js`). The protobuf in tree matches https://assets.upstox.com/feed/market-data-feed/v3/MarketDataFeed.proto. One-minute candles already expose `[time, open, high, low, close, volume]` for a traded symbol (`UpstoxProvider.js` historical and intraday parsers). Candle `time` is the bar open, in unix seconds. Saved history is the same shape (`server/src/market/historyStore.js`), about three months, with a day marked partial while it is still being written.

A cash session bar is a minute whose IST start is from 09:15 inclusive through 15:29 inclusive: 375 possible bars. The 15:30 close is not a bar open. A bar is complete only when the server clock is at least 60 seconds past its open. The forming minute is dropped even if a provider has already emitted it.

Primary method reference: Easley, López de Prado, and O'Hara, *The Review of Financial Studies* 25(5), 2012, https://doi.org/10.1093/rfs/hhs053. Bulk classification: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1989555. This spec implements that candle form, not a tick-rule tape and not an exchange aggressor flag. The feed has no aggressor flag.

## Estimate

### Which sessions

`anchorSession` is the trading day being described. On a trading day at or after 09:15 IST it is that IST date. Before 09:15, on a weekend, or on a configured holiday, it is `lastTradingDayKey` from `server/src/market/marketHours.js`. Empty `NSE_HOLIDAYS` stays empty. A weekday the calendar does not know is a holiday is kept or skipped only by the bar-count test below, not by an invented date list.

`calibrationSession` is the nearest day strictly before `anchorSession` that passes the completeness test, searching at most 15 calendar days and skipping weekends and configured holidays. Completeness, all of the following:

- At least 370 distinct session-minute opens out of 375, after dropping non-finite closes and negative or non-finite volumes.
- At least 31 finite closes, so there are at least 30 close-to-close changes.
- Poured volume at least 50. Poured volume is the sum of floored share volumes of every session minute except the first. The first minute is present for its close only.

If no reachable day has any session bars, or bars exist but none pass the bar-count and close-count tests, status is `no-history`. If bars pass those two counts but every such day has poured volume under 50, status is `no-volume`. Do not call a new Upstox endpoint and do not widen the provider page size. The existing one-minute read is a short recent window (about four calendar days plus today). The saved store is the longer source. If that combined set has no qualifying day, stop.

### One bucket size

`bucketVolume` V is `floor(pouredCalibrationVolume / 50)` in whole shares. V is at least 1 whenever the completeness test passed. Every bucket in the answer uses this V. `calibrationVolume` in the response is that poured volume, not the first minute.

Bars included, in time order, after de-duplicating on `time` (last copy wins):

1. Completed session minutes of `calibrationSession`.
2. Completed session minutes of `anchorSession`.

The first calibration minute has no in-session previous close. Its volume is not poured into a bucket. Its close is the previous close for the next calibration minute. Do not fetch an older session only to seed that one close. The first anchor minute uses the last calibration close, which is already in the past.

A minute with volume 0 updates the previous close and `asOf` when it is the latest completed minute, and it adds no shares to a bucket. A minute with a non-finite close or a negative or non-finite volume is dropped. Remaining volumes are floored to whole shares.

Volume is poured in time order. A minute whose buy and sell shares exceed the space left in the open bucket is split. The slice that fills the bucket keeps that minute's buy fraction. The remainder starts the next bucket with the same fraction. A trailing remainder smaller than V is not a bucket and is not in the average.

When `anchorSession` changes, V is recomputed from the new calibration day and the buckets are built again from the bars. Buckets filled under a previous V are not averaged with buckets filled under the new V. The cache key includes V, so an old entry cannot satisfy a new session.

### Volatility

Sigma is the sample standard deviation of close-to-close changes inside `calibrationSession` only, divisor `m - 1`, with `m` at least 30. It is fixed for the whole answer. Anchor-session changes do not enter sigma. Later minutes do not revise the classification of an earlier minute.

For a classified minute, `z = (close - previousClose) / sigma`, and the buy fraction is the standard normal CDF of `z`. The sell fraction is one minus the buy fraction. `z` is clamped to the closed interval [-8, 8] before the CDF so the tail approximation cannot move the fraction off 0 or 1. If sigma is 0, the buy fraction is 1 when the change is positive, 0 when it is negative, and 1/2 when it is 0. That rule avoids dividing by zero. It is still BVC with a degenerate scale, and the response stays honest because sigma is reported.

### The number

A full bucket has buy shares plus sell shares equal to V. Its imbalance is the absolute difference divided by V. VPIN is the arithmetic mean of the last 50 full-bucket imbalances. It lies on [0, 1].

`bucketsRequired` is 50. `bucketsHave` is the count of full buckets after the pour, which may exceed 50. The mean uses only the last 50. `value` is present only when `bucketsHave >= 50`. Otherwise `value` is null and, if a calibration day was found, status is `warming`. A calibration day that passed the poured-volume test produces at least 50 full buckets before the anchor day adds any, because `floor(pouredCalibrationVolume / V) >= 50`. The threshold is not lowered.

`anchorBucketsInWindow` counts how many of those last 50 buckets, or how many of the full buckets when there are fewer than 50, closed on an anchor-session minute. A bucket closed by a split keeps the session of the minute that filled it.

The unsigned mean is the only reading. The response has no buy-fraction field and no side.

Status is exactly one of the six names. Choose the first match: `unsupported`, `no-history`, `no-volume`, `warming` when `bucketsHave < 50`, `stale` when the clock expects a newer completed minute than `asOf`, otherwise `ready`.

## API

`GET /api/market/vpin/:symbol`

Mounted on the existing `/api/market` router, so `requireAuth` is the same Bearer JWT check as the other market routes (`server/src/app.js`). No new auth mode.

Symbol handling, in order:

1. Trim and uppercase. Reject with 400 unless the result matches `^[A-Z0-9 &-]{1,32}$`.
2. Known index (`isIndex`): HTTP 200, `status: "unsupported"`, `value: null`.
3. Not `isTradable`: HTTP 404, the same unknown-symbol outcome as `/api/market/candles/:symbol`.
4. Otherwise compute.

Success and handled empty states are HTTP 200. The body always has these keys:

| Field | Rule |
|---|---|
| `symbol` | Requested constituent, or the index when unsupported |
| `method` | `"bvc-1m"` |
| `status` | `ready`, `warming`, `stale`, `unsupported`, `no-volume`, or `no-history` |
| `value` | Number on [0, 1] with at most 6 decimal places, or null |
| `bucketsHave` | Integer, 0 when there is no estimate. May exceed 50 |
| `bucketsRequired` | 50, or null when unsupported |
| `anchorBucketsInWindow` | Integer 0–50, or null when unsupported |
| `bucketVolume` | V, or null |
| `calibrationVolume` | Poured calibration shares, excluding the first minute, or null |
| `sigma` | Calibration sigma, or null. Zero is a real reported value |
| `calibrationSession` | `YYYY-MM-DD` or null |
| `anchorSession` | `YYYY-MM-DD` or null |
| `asOf` | ISO time of the last completed minute that was eligible, or null. This is the candle open, not receipt time |
| `historical` | True when `asOf` is not a completed minute of an anchor session whose date is today's IST date |
| `live` | True only when `status` is `ready`, `historical` is false, `anchorBucketsInWindow` is 50, the provider is not the mock, and `asOf` is exactly the latest minute the clock says is already complete |
| `simulated` | True when the configured provider is the mock |
| `asOfSource` | `saved-candles`, `upstox-candles`, or `mock-candles` |
| `calibrationSource` | Same three names, naming where the calibration day was read |

`no-volume` and `no-history` follow the session search above. Both have `value: null` and `live: false`. A day that fails the bar-count test is not relabeled `no-volume`.

`stale` is used only when today's IST date equals `anchorSession`, the clock is inside 09:15–15:30 IST, and the latest completed minute is missing. The body still includes `value` when 50 buckets exist. `live` is false. After 15:30, before the next 09:15, and on a weekend or configured holiday, the last session minute is the expected bar, so a complete answer is `ready` with `historical: true` and `live: false`, not `stale`. A Friday 15:29 bar shown on Saturday is that case.

Candle load uses `HistoryStore` for days it already covers, and the existing one-minute provider read only for the uncovered tail. `asOfSource` is the origin of the `asOf` bar. A provider error with a usable saved calibration day still returns the saved estimate. A provider error with nothing saved returns `no-history`. No order-book quantity and no last-trade price is copied in as volume.

## UI

On `client/src/pages/StockDetail.jsx`, render one card only when the route symbol is in `instruments.stocks`. Place it under the candle chart and above `SignalCard`. The index page already fails the stock check and does not gain a card.

The card shows:

- Title `VPIN` and the sentence `BVC 1-minute estimate. Not a buy or sell signal.`
- The value as three decimal places, or an em dash when `value` is null.
- `bucketsHave` capped at 50 for the fraction text, over `50`, for example `50/50` or `18/50`.
- `asOf` in IST, or `No completed minute` when null.
- One state line: `Live`, `Includes previous session`, `Previous session`, `Stale`, `Warming up`, `No volume`, or `Not enough history`. `Live` is `live === true`, which requires all 50 averaged buckets to be from the anchor session. `Includes previous session` is `status === "ready"` and `historical === false` and `anchorBucketsInWindow < 50`. `Previous session` is `historical && status === "ready"`.
- When `simulated` is true, add `Simulated feed. Not an Upstox session.` and do not show `Live`.

The card does not plot a marker on the chart, does not open the order sheet, and does not read or write order, risk, or wallet state.

Fetch `GET /api/market/vpin/${symbol}` through `useApi`, once when the symbol changes and then at most once per 60 seconds while the card is mounted. Do not put the socket tick `version` in the dependency list. The path contains the symbol, so the existing generation guard in `useApi` drops a response that belongs to the previously open stock. On a path change, clear the previous value before the next one arrives.

## Server boundaries

| Unit | Responsibility |
|---|---|
| Pure estimator | Bars in, estimate object out. No clock read inside the pour except the `now` argument the caller passes. No network, no Mongo, no order engine. |
| Loader | Resolves symbol, reads candles through the existing market history methods, chooses sources, calls the estimator, stores the response in a process-local cache. |
| Route | Auth already applied. Validates the symbol and returns the cached or fresh body. |

The order engine, scanner, auto trader, and option trader do not import the estimator.

Cache at most 64 responses. The key is `symbol`, `calibrationSession`, `bucketVolume`, and `asOf`. Inserting a 65th deletes the oldest. A request computes one symbol and at most two sessions of bars (750 minutes). There is no timer and no all-constituents sweep. This is the bound for the 1 GB arm64 host.

## Errors

| Case | Result |
|---|---|
| Missing or bad JWT | Existing 401 |
| Malformed symbol | 400, no body estimate |
| Unknown or option symbol | 404 |
| Index | 200 `unsupported` |
| No day passes the bar-count and close-count tests | 200 `no-history` |
| Those counts pass but poured volume stays under 50 | 200 `no-volume` |
| Qualifying day but fewer than 50 buckets after filters | 200 `warming` |
| Broker down, saved day usable | 200 from saved candles |
| Broker down, nothing saved | 200 `no-history` |
| Unexpected throw | Existing 500 middleware |

## Tests

Pure estimator, without a network:

- A one-sided run of up-closes fills buy volume and produces a high VPIN. An alternating series produces a lower one. Neither result is labeled with a side.
- A minute larger than the remaining bucket space contributes to two buckets and does not change V.
- Volume that is not a multiple of V leaves a remainder that is absent from the mean.
- The 49th full bucket yields `warming` and `value: null`. The 50th yields a number.
- Sigma for a minute does not change when a later minute is appended. Appending a future-dated minute past `now` does not change the result.
- Sigma 0 with a positive, negative, and zero change follows the 1 / 0 / 1/2 rule.
- The first calibration minute's volume is excluded. The first anchor minute uses the calibration close.
- A zero-volume minute moves `asOf` and the previous close without creating a bucket.
- Two days with different total volumes never share a bucket list: after the anchor rolls, V changes and the mean is rebuilt.
- `NIFTY 50` is `unsupported` with a null value. A non-constituent is 404.
- Saturday `now` with a complete Friday returns `ready`, `historical: true`, `live: false`, and `asOf` at Friday 15:29 IST when that bar exists.
- During the session, a missing latest minute is `stale` and `live: false`. The 15:29 bar after 15:30 is `ready` and not live.
- Order, risk, and wallet tests stay green without importing the estimator.

Client: the card renders `Live`, `Includes previous session`, `Previous session`, and `Stale` from fixture payloads, and a symbol change does not keep the previous number. No order button is added.

## Rollout and rollback

Ship only by a later, separate change on this same branch family. The server file and a rebuilt `phone-app` are the runtime pieces. `npm ci --omit=dev` on the host does not need a new package. No Mongo migration and no `.env` edit.

Rollback is the previous server tree and the previous `phone-app`. There is no new collection and no ledger row to undo. The cash ledger, fresh-quote gate, and strategy modules stay untouched by this feature, so restoring those files is not part of a VPIN rollback.

## Out of scope

Tick-rule or `ltq` VPIN, option VPIN, an index proxy, scanner columns, alerts, a trade filter, sizing, exits, new persistence, and any change to signal formulas or saved settings.
