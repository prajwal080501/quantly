# Upgrade notes for the paper-safety release

Paper execution only. This does not place broker orders. Do not replace `/opt/trading-helper/server/.env`. Do not touch `/opt/sthir` or any other machine.

## Target this release was packed for

- linux arm64, Node v22.23.4, npm 10.9.9
- App directory `/opt/trading-helper`
- systemd `trading-helper.service` runs `/usr/bin/node src/index.js` in `server/`
- nginx TLS in front, proxy to `127.0.0.1:5000`
- Mongo 7 container `trading-helper-mongo`, `127.0.0.1:27017`, volume `trading-helper-mongo-data`
- `db.hello().setName` is null. The URI has no `replicaSet`. This release does not use multi-document transactions. Do not convert that node to a replica set and do not wipe the volume.

## What the database change does

New collections `cashpostings` and `fillledgers` appear on the next paper fill. The first balance read inserts one posting `opening:<userId>` equal to the current `balance - startingBalance` when the ledger is empty and those two numbers differ. Existing orders, positions, and trades stay. Wallet reset behavior is unchanged and is not run by the upgrade.

## Steps

1. Back up the Mongo volume (`trading-helper-mongo-data`) and copy `/opt/trading-helper/server/.env` aside. Do not commit either.
2. Stop only `trading-helper.service`. Leave the Mongo container and PM2 process for `/opt/sthir` running.
3. Unpack the source archive over `/opt/trading-helper`, excluding `server/.env`.
4. Replace `/opt/trading-helper/phone-app` with the frontend asset archive. The server prefers `phone-app/` over `client/dist`. The arm64 host should not run Vite.
5. In `server/`, run `npm ci --omit=dev`. Production dependencies are pure JavaScript (`bcryptjs`, not `bcrypt`).
6. Keep the existing `.env`. Add only:
   - `UPSTOX_OPERATOR_EMAILS` = the operator address allowed to replace the market-data token. If this is empty, token refresh returns 403. The current token keeps working until Upstox expires it.
   - `RELEASE_SHA` = the git commit named in `SHA256SUMS`.
7. Start `trading-helper.service` again.

## Checks after start

Do these against the real process. Do not treat a Saturday as proof of a fresh intraday trade print.

- `GET /api/health` returns `paperOnly: true`, `quotePolicy: "fresh-upstream-timestamp"`, `version`, and `releaseSha` equal to the manifest. `startingBalance` must still be the configured value, not a reset.
- `GET /api/market/status` on Saturday: `market.phase` is `WEEKEND`, `market.isOpen` is false. `holidayCalendar` is `unconfigured` while `NSE_HOLIDAYS` is empty. That is expected. Do not invent holiday dates in this upgrade.
- `feed.auth` is `ok` when the message is a live connection, `expired` when the message says the Upstox token is invalid or HTTP 401, and `disconnected` when the socket is down for another reason. An expired token on Saturday is a data-feed fact, not a failed release.
- A new paper entry while the feed has no fresh upstream timestamp is rejected. The last cached price is not a fill. Open protective orders stay open.

## Rollback

Copying the old code back is not enough while a fill is only partly written. The new process replays any `fillledgers` row with `applied` not true when it starts. Let that process finish startup, then stop it, restore the previous tree and `phone-app`, and start the old service. After a finished replay, `wallet.balance` matches the ledger and the old code can use that field. The `cashpostings`, `fillledgers`, and `ledgerAdopted` fields are ignored by the old build.

If you stop the new process in the middle of a fill and do not let it start again, restore the Mongo backup taken before the upgrade. Do not drop the volume as a shortcut, and do not delete orders, positions, or trades by hand.
