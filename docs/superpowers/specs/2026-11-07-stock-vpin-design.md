# Display-only stock VPIN

**Status:** Approved design, revised for internal consistency. Written for review before any implementation plan. This document does not authorize feature code, a trading-rule change, or a deploy.

**Base:** `15f9af04be63bd9b02dbe4c23275dbdf984c93a6` on `cursor/paper-safety-fresh-quotes-1d33`. Later work starts from that application commit, not from old `main`.

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

## Clock and sessions

The server clock and `NSE_HOLIDAYS` are the only calendar inputs. `istParts`, `isTradingDay`, and `lastTradingDayKey` in `server/src/market/marketHours.js` are the functions. Empty `NSE_HOLIDAYS` stays empty. This spec does not add holiday dates.

`phase` is exactly one of these, from the clock:

| Phase | When |
|---|---|
| `weekend` | Saturday or Sunday |
| `holiday` | Monday–Friday whose IST date is in the configured holiday list |
| `preopen` | A trading day before 09:15:00 IST |
| `open` | A trading day from 09:15:00 inclusive to 15:30:00 exclusive |
| `closed` | A trading day at or after 15:30:00 IST |

An unlisted weekday closure stays `preopen`, `open`, or `closed`. During `open`, a missing expected minute is `stale`. During `closed` or `preopen`, a missing bar is not called `stale`. It is not relabeled as a holiday.

`anchorSession` is `lastTradingDayKey(now, holidays)`. That is today once a trading day has reached 09:15 IST, including after the 15:30 close. Before 09:15, on a weekend, and on a configured holiday, it is the previous trading day.

`expectedAsOf` is the open time of the newest session minute the clock already considers complete:

- `open` and the clock is still before 09:16:00: none. No anchor minute is complete.
- `open` from 09:16:00 onward: the latest session open `M` with `M + 60s <= now`. At 09:16:00 that is 09:15. At 15:29:59 that is 15:28.
- `closed`: 15:29 of `anchorSession`. At 15:30:00 the 15:29 bar is complete and no later session bar exists.
- `preopen`, `weekend`, and `holiday`: 15:29 of `anchorSession`, which is already in the past.

`calibrationSession` is the nearest day strictly before `anchorSession` that passes the completeness test, searching at most 15 calendar days and skipping weekends and configured holidays.

## Estimate

### Completeness

Evaluated on the filtered session minutes of that day. A minute with a non-finite close, or a negative or non-finite volume, is not a counted bar. Completeness is all of the following:

- At least 370 distinct session-minute opens out of 375.
- At least 31 finite closes, so there are at least 30 close-to-close changes.
- Classified volume at least 50 shares. Classified volume excludes the burn-in defined under Volatility. The first of those closes exists only to start the changes.

If no reachable day has any session bars, or none pass the bar-count and close-count tests, status is `no-history`. If some days pass those two counts and every one of them has classified volume under 50, status is `no-volume`. A day that fails the bar-count test is not called `no-volume`.

Do not call a new Upstox endpoint and do not widen the provider page size. The existing one-minute read is a short recent window (about four calendar days plus today). The saved store is the longer source. If that combined set has no qualifying day, stop.

### One bucket size

`bucketVolume` V is `floor(classifiedCalibrationVolume / 50)` in whole shares. V is at least 1 whenever the completeness test passed. Every bucket in the answer uses this V. `calibrationVolume` in the response is that classified volume.

Bars included, in time order, after de-duplicating on `time` (last copy wins):

1. Completed session minutes of `calibrationSession`.
2. Completed session minutes of `anchorSession` that are already complete at `now`.

Volume is poured in time order. A minute whose buy and sell shares exceed the space left in the open bucket is split. The slice that fills the bucket keeps that minute's buy fraction. The remainder starts the next bucket with the same fraction. A bucket closed by a split takes the session of the minute that filled it. A trailing remainder smaller than V is not a bucket and is not in the average.

A minute with volume 0 updates the previous close and can advance `asOf`. It adds no shares. Remaining volumes are floored to whole shares.

When `anchorSession` changes, V is recomputed from the new calibration day and the buckets are built again from the bars. Buckets filled under a previous V are not averaged with buckets filled under the new V. The candle cache is keyed by symbol and `anchorSession`, so the previous anchor's buckets cannot be reused.

### Volatility

Sigma is causal. For the minute being classified, it is the sample standard deviation of close-to-close changes whose later close is strictly earlier than that minute's close. The divisor is `m - 1`. Classification starts only once `m` is at least 30. Those burn-in minutes keep their closes, and their volume is not poured.

That sigma does not include the minute's own change or any later change. Appending a later minute does not change the buy fraction already computed for an earlier minute. Anchor-session minutes use the same rule, so their prior sample can include calibration changes and earlier anchor changes. It still cannot include the future.

This is not a full-day sigma applied backward. A warm seed carried into the next morning is the estimate as of the calibration session's last completed minute. It is not a value that the same procedure would have published at the first classified minute of that day. `asOf` is that last minute when no anchor minute is complete. The screen says previous session, not live.

For a classified minute, `z = (close - previousClose) / sigma`, clamped to [-8, 8], and the buy fraction is the standard normal CDF of `z`. The sell fraction is one minus the buy fraction. If the prior sample has sigma 0, the buy fraction is 1 when the change is positive, 0 when it is negative, and 1/2 when it is 0. A later non-zero change does not go back and replace that zero. Sigma in the response is the sigma used for the last classified minute, and zero is reported as zero.

The first anchor minute's previous close is the last calibration close. No older session is loaded only to seed a close.

### The number

A full bucket has buy shares plus sell shares equal to V. Its imbalance is the absolute difference divided by V. VPIN is the arithmetic mean of the last 50 full-bucket imbalances. It lies on [0, 1].

`bucketsRequired` is 50. `bucketsHave` is the count of full buckets after the pour and may exceed 50. The mean uses only the last 50. `value` is present only when `bucketsHave >= 50`.

A calibration day that passed the classified-volume test produces at least 50 full buckets before the anchor day adds any, because `floor(classifiedCalibrationVolume / V) >= 50`. The public loader therefore does not emit a waiting state. If a day that passed the predicate still pours fewer than 50 buckets, the loader returns `no-history` and `value: null`. The 50-bucket rule is not lowered, and no bars are invented to fill the gap.

The pure estimator can still be called with a caller-supplied V and a short bar list. That call may report 49 full buckets and no value. That result is an estimator fixture. It is not a public status and the route does not map it to one.

`anchorBucketsInWindow` counts how many of the averaged buckets, or how many of the full buckets when there are fewer than 50, closed on an anchor-session minute.

The unsigned mean is the only reading. The response has no buy-fraction field and no side.

## Flags

`historical`, `live`, and `stale` are derived on every request from `phase`, `expectedAsOf`, `asOf`, and the cached estimate. They are not stored as the cache identity.

`historical` is true only when `value` is a number and either `phase` is not `open`, or `asOf` is not a completed minute of today's `anchorSession`. The second clause covers 09:15:00–09:15:59, when phase is already `open` but the 09:15 bar is not complete and `asOf` is still the previous session. At and after 15:30:00, phase is `closed`, so a value is historical even when `asOf` is today's 15:29 bar and every averaged bucket is today's. When `value` is null, `historical` is false. False means no historical reading is being shown. It does not mean the market is live.

`live` is true only when all of these hold: `phase` is `open`, status is `ready`, `historical` is false, `anchorBucketsInWindow` is 50, `simulated` is false, and `asOf` equals `expectedAsOf`. The close at 15:30:00 fails the phase test, so `live` is false even when all 50 buckets are from today and `asOf` is 15:29.

`stale` is true only when `phase` is `open`, `expectedAsOf` is not null, and `asOf` is null or earlier than `expectedAsOf`. It is false in `preopen`, `closed`, `weekend`, and `holiday`. A missing 15:29 bar after 15:30:00 is not `stale`. It is `no-history` if the calibration day also fails, otherwise `ready` or `no-volume` from the bars that do exist, with `historical` true when a value exists. During `open`, a value may still be returned while status is `stale`. `live` stays false.

Public status is exactly one name. Choose the first match: `unsupported`, `no-history`, `no-volume`, `stale`, `ready`. There is no public `warming` status.

## API

`GET /api/market/vpin/:symbol`

Mounted on the existing `/api/market` router, so `requireAuth` is the same Bearer JWT check as the other market routes (`server/src/app.js`). No new auth mode.

Symbol handling, in order:

1. Trim and uppercase. Reject with 400 unless the result matches `^[A-Z0-9 &-]{1,32}$`.
2. Known index (`isIndex`): HTTP 200 and the empty body below with `status: "unsupported"`.
3. Not `isTradable`: HTTP 404, the same unknown-symbol outcome as `/api/market/candles/:symbol`.
4. Otherwise compute.

Success and handled empty states are HTTP 200. The body always has these keys:

| Field | Rule |
|---|---|
| `symbol` | Requested constituent, or the index when unsupported |
| `method` | `"bvc-1m"` |
| `status` | `ready`, `stale`, `unsupported`, `no-volume`, or `no-history` |
| `value` | Number on [0, 1] with at most 6 decimal places, or null |
| `bucketsHave` | Integer. May exceed 50. Zero when there is no pour |
| `bucketsRequired` | 50, or null when unsupported |
| `anchorBucketsInWindow` | Integer 0–50, or null when unsupported or when there is no pour |
| `bucketVolume` | V, or null |
| `calibrationVolume` | Classified calibration shares, or null |
| `sigma` | Sigma of the last classified minute, or null. Zero is a real reported value |
| `calibrationSession` | `YYYY-MM-DD` or null |
| `anchorSession` | `YYYY-MM-DD` or null |
| `asOf` | ISO open time of the last completed minute that was eligible, or null. This is the candle open, not receipt time |
| `historical` | As defined under Flags |
| `live` | As defined under Flags |
| `simulated` | True when the configured provider is the mock |
| `asOfSource` | `saved-candles`, `upstox-candles`, `mock-candles`, or null |
| `calibrationSource` | The same four values, naming where the calibration day was read |

`no-history`, `no-volume`, and `unsupported` set `value` null, `historical` false, `live` false, and `asOf` null. `unsupported` also sets the session, volume, sigma, bucket, and source fields to null. `no-history` and `no-volume` set both source fields to null. They do not claim a candle origin.

When a value exists, `calibrationSource` and `asOfSource` may differ. That is the mixed case: the calibration day came from one store and the `asOf` bar from another. Neither field is rewritten to look like a single origin. `asOfSource` is null when `asOf` is null, and `calibrationSource` is null when no calibration day was selected.

Candle load uses `HistoryStore` for days it already covers, and the existing one-minute provider read only for the uncovered tail. A provider error with a usable saved calibration day still returns the saved estimate and sets `calibrationSource` to `saved-candles`. A provider error with nothing saved returns `no-history` with both sources null. No order-book quantity and no last-trade price is copied in as volume.

## Fetch bound

One process-local candle cache. Clock flags are computed on read and are not a second stored result.

The candle cache stores the bars and the numeric estimate for one symbol and one `anchorSession`. It holds at most 50 entries, one per constituent. A 51st insert deletes the oldest. An entry expires 60 seconds after it was stored, and it is unused when the clock's `anchorSession` no longer matches the key. Concurrent requests for the same symbol and anchor share one in-flight load. The second request waits on that promise and does not start another Upstox or Mongo read.

A cache hit still recomputes `historical`, `live`, and status from the current clock and the stored `asOf`. Those flags are not frozen for the 60 seconds. At 15:30:00 a hit on the 15:29 estimate flips `historical` to true and `live` to false without a fetch. During `open`, a hit whose `asOf` is behind the new `expectedAsOf` becomes `stale` immediately. The next request after expiry loads candles again. If the saved store already contains `expectedAsOf`, that refresh does not call Upstox.

The route does not compute every constituent. One request handles one symbol and at most two sessions of bars. There is no timer. This is the bound for the 1 GB arm64 host. The client polls at most once per 60 seconds, so the server cap is the backstop.

## UI

On `client/src/pages/StockDetail.jsx`, render one card only when the route symbol is in `instruments.stocks`. Place it under the candle chart and above `SignalCard`. The index page already fails the stock check and does not gain a card.

The card shows:

- Title `VPIN` and the sentence `BVC 1-minute estimate. Not a buy or sell signal.`
- The value as three decimal places, or an em dash when `value` is null.
- The window as `min(bucketsHave, 50)/50`, for example `50/50`.
- `asOf` in IST, or `No completed minute` when null.
- One state line, first match: `No volume`, `Not enough history`, `Stale`, `Live`, `Includes previous session`, `Previous session`. `Live` follows `live === true`. `Includes previous session` is `ready`, not historical, and `anchorBucketsInWindow < 50`. `Previous session` is `historical` and `ready`. `Stale` wins over `Previous session` when both could apply.
- When `simulated` is true, add `Simulated feed. Not an Upstox session.` and do not show `Live`.

The card does not plot a marker on the chart, does not open the order sheet, and does not read or write order, risk, or wallet state.

Fetch `GET /api/market/vpin/${symbol}` through `useApi`, once when the symbol changes and then at most once per 60 seconds while the card is mounted. Do not put the socket tick `version` in the dependency list. The path contains the symbol, so the existing generation guard in `useApi` drops a response that belongs to the previously open stock. On a path change, clear the previous value before the next one arrives.

## Server boundaries

| Unit | Responsibility |
|---|---|
| Pure estimator | Bars, a caller-supplied `now`, and holidays in. Estimate numbers out. No network, no Mongo, no order engine. |
| Loader | Resolves the symbol, applies the fetch bound, reads candles through the existing market history methods, calls the estimator, then applies the clock flags. |
| Route | Auth already applied. Validates the symbol and returns the body. |

The order engine, scanner, auto trader, and option trader do not import the estimator.

## Errors

| Case | Result |
|---|---|
| Missing or bad JWT | Existing 401 |
| Malformed symbol | 400, no estimate body |
| Unknown or option symbol | 404 |
| Index | 200 `unsupported`, null `asOf`, `historical` false |
| No day passes the bar-count and close-count tests | 200 `no-history`, null `asOf`, `historical` false, sources null |
| Those counts pass but classified volume stays under 50 | 200 `no-volume`, null `asOf`, `historical` false, sources null |
| Qualified day pours fewer than 50 buckets | 200 `no-history`. Not a waiting state |
| Broker down, saved day usable | 200, `calibrationSource` `saved-candles` |
| Broker down, nothing saved | 200 `no-history`, sources null |
| Unexpected throw | Existing 500 middleware |

## Tests

Pure estimator, without a network. V may be supplied by the test so the pour can be inspected below the public completeness rule:

- A one-sided run of up-closes fills buy volume and produces a high VPIN. An alternating series produces a lower one. Neither result is labeled with a side.
- A minute larger than the remaining bucket space contributes to two buckets and does not change V.
- Volume that is not a multiple of V leaves a remainder that is absent from the mean.
- With a supplied V, 49 full buckets produce no value. The 50th produces a number. This fixture is not asserted as a public route status.
- Classifying minute `t`, then appending minute `t+1`, leaves the buy fraction of minute `t` unchanged. The test builds sigma from changes before `t` only. A full-sample sigma fit on the whole series is not the expected procedure.
- Sigma 0 on the prior sample, with a positive, negative, and zero change, follows the 1 / 0 / 1/2 rule. A later non-zero change does not rewrite that minute.
- Burn-in volume, before 30 prior changes exist, is excluded. The first anchor minute uses the last calibration close.
- A zero-volume minute moves `asOf` and the previous close without creating a bucket.
- Two days with different classified volumes never share a bucket list: after the anchor rolls, V changes and the mean is rebuilt.
- A future-dated minute at or after `now` does not change the result.

Loader and route, still without a live broker:

- `NIFTY 50` is `unsupported` with a null value, null `asOf`, and `historical` false. A non-constituent is 404.
- `no-history` and `no-volume` have null `asOf`, `historical` false, `live` false, and both source fields null.
- A calibration day from the saved store and an anchor bar from the provider read report those two sources separately.
- Saturday `now` with a complete Friday returns `ready`, `historical` true, `live` false, and `asOf` at Friday 15:29 IST when that bar exists. The same shape is returned on a configured holiday. The Friday value is as of Friday 15:29, not as of Friday morning.
- Monday 09:15:00 is `preopen`'s opposite edge: phase is `open`, no anchor minute is expected, `historical` is true, and status is not `stale`.
- Monday 09:16:00 expects the 09:15 bar. If it is missing, status is `stale` and `live` is false.
- Monday 15:30:00 with today's 15:29 bar and 50 anchor buckets returns `ready`, `historical` true, and `live` false.
- Monday 15:29:59 can be `live` only if `asOf` is 15:28, all 50 averaged buckets are Monday's, and the provider is not the mock.
- Two overlapping requests share one candle load. A request 30 seconds later does not call the provider. A request at 15:30:00 served from that cache is historical and not live.
- Order, risk, and wallet tests stay green without importing the estimator.

Client: the card renders `Live`, `Includes previous session`, `Previous session`, and `Stale` from fixture payloads, and a symbol change does not keep the previous number. No order button is added.

## Rollout and rollback

Ship only by a later, separate change on this same branch family. The server file and a rebuilt `phone-app` are the runtime pieces. `npm ci --omit=dev` on the host does not need a new package. No Mongo migration and no `.env` edit. VPIN writes no `cashpostings` row and no `fillledgers` row.

Removing the VPIN route and card does not finish a paper fill. The deployed ledger still replays any `fillledgers` row whose `applied` flag is not true when that hardened process starts. Copying an older tree back while such a row is unfinished does not complete the fill. Let the hardened process finish startup, or restore the Mongo backup taken before that ledger existed. Do not drop the volume. The VPIN files themselves have no collection to delete.

## Out of scope

Tick-rule or `ltq` VPIN, option VPIN, an index proxy, scanner columns, alerts, a trade filter, sizing, exits, new persistence, and any change to signal formulas or saved settings.
