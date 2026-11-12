# QA failure and recovery report

Date: 2026-11-11. Script: `tests/qa/failure-recovery.mjs`. Accepted raw result:
`scratch/qa/raw/failure-recovery-2026-11-11T03-38-26-389Z.json`. **18/18 passed.**

The database stop ran only after the script confirmed the connection was
`127.0.0.1:55432/vishrea_qa` and the data directory was the throwaway cluster under the user temp
folder. The live Supabase project was not contacted.

## Results

| Check | Result | Evidence |
|---|---|---|
| Identity of the database | Pass | Throwaway cluster only |
| Baseline health | Pass | HTTP 200, `db: up` |
| Null byte in `full_name` | Pass | HTTP 400 `invalid_full_name`, no stack |
| Stand-in `timeout` | Pass | HTTP 502 `payment_gateway_unreachable` in 15.1 s; checkout-fixture stock unchanged |
| Stand-in `error500` | Pass | HTTP 502 `payment_gateway_error` in 51 ms; stock unchanged |
| Stand-in `garbage` (HTTP 200, invalid JSON) | Pass | HTTP 502 `payment_gateway_error` in 63 ms; stock unchanged. The client treats the body as empty and rejects the amount mismatch, then expires the order so stock is not held |
| Stand-in returned to `ok` | Pass | HTTP 201 checkout |
| Cancel | Pass | HTTP 200; reserved unit released |
| Two checkouts, one idempotency key | Pass | HTTP 201 and 200, one order id |
| Stock after cancel | Pass | Same total as before the case (299,999 across the fixture's variants) |
| Client abort mid-catalogue | Pass | Following `/api/health` was HTTP 200 |
| `pg_ctl stop` on the throwaway cluster | Pass | Fast shutdown |
| Health while the database is down | Pass | HTTP 503, `db: down`, no stack trace |
| `pg_ctl start` on port 55432 | Pass | Server started |
| API after the database returns | Pass | HTTP 200 |
| Stock after the outage | Pass | Unchanged |

## First attempt

The first execution (15/18) stopped the cluster and then called `pg_ctl start` without the port.
PostgreSQL did not come back, and the API stayed on 503. The cluster was started manually with
`-p 55432` and `-c listen_addresses=127.0.0.1`. The script now uses those arguments and writes its log
outside the data directory. The accepted run is the second execution.

Earlier the same morning the throwaway cluster would not boot because empty directories (`pg_notify`
and the other initdb directories) were missing from the temp data folder. They were recreated empty.
Existing `base`, `global` and `pg_wal` were left in place. Recovery completed and `vishrea_qa` was
readable (421 products and 1,022 QA users at that moment). Nothing was initialised over the data.

## Not covered here

Connection-pool exhaustion and a lock held across `statement_timeout` were not run as separate cases.
The database-down case already forces every pooled query to fail and then recover. A second server with
`DB_POOL_MAX=2` was not started, so this report does not claim a pool-capacity number.
