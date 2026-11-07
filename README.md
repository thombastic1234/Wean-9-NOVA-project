# PassCheck — Wean-9-NOVA-project

Restaurant ordering and handoff workspace with five authenticated views: **Manager, Customer, Waiter, Chef, and Driver**. The top menu keeps role navigation together. Packaging lives inside the Waiter view; managers can perform the same operational actions with the same validation.

The menu is **Burger, Fries, Milkshake, and Salad** (`burger`, `fries`, `milkshake`, `salad`). Demo prices are USD $9, $4, $6, and $7 respectively. Options and preparation notes are free text; options do not add charges. Totals are calculated on the server, with no tax or delivery fees in this prototype.

## Setup

Use **Node.js 24+**. The existing Next.js / React / TypeScript / Zod stack is retained. SQLite comes from Node's built-in `node:sqlite`; no database service or additional npm dependency is needed.

```sh
npm ci
```

Copy `.env.example` to `.env.local`. Leave `OPENROUTER_API_KEY` blank to use rules prioritization and manual packing. It always stays server-side. Set `PASSCHECK_DATABASE_PATH` to a writable persistent file; the default is `data/passcheck.sqlite`.

Create each account using the server CLI. It prompts for a password without echoing it (minimum 12 characters):

```sh
npm run account -- --role MANAGER --email manager@example.com --name Manager
npm run account -- --role CUSTOMER --email customer@example.com --name Customer
npm run account -- --role WAITER --email waiter@example.com --name Waiter
npm run account -- --role CHEF --email chef@example.com --name Chef
npm run account -- --role DRIVER --email driver@example.com --name Driver
npm run dev
```

Open http://127.0.0.1:3000 and sign in. There are **no default production passwords**, public role registration, or production role-switch endpoints. The account command loads `.env.local` so it uses the same database as Next.js. For noninteractive account setup, supply `PASSCHECK_ACCOUNT_PASSWORD` through the server environment; never put it in a `NEXT_PUBLIC_` variable or commit it.

For production-mode rehearsal: `npm run build`, then `npm start`. Production requires HTTPS outside localhost and a persistent writable disk. This SQLite implementation targets one restaurant on a single Node server, not ephemeral serverless storage or independent replicas. Back up the SQLite database and its WAL consistently. Users, sessions, orders, and settings are local data and are excluded from Git.

On this Windows machine, the portable runtime used for checks is `%TEMP%\passcheck-runtime\node-v24.22.2-win-x64`. If Node is missing from PATH, set `$env:Path = "$env:TEMP\passcheck-runtime\node-v24.22.2-win-x64;$env:Path"` in PowerShell first.

## Development demo identities

Set `PASSCHECK_DEMO_MODE=true` in `.env.local`, then run **`npm run dev`**. The clearly labeled development control signs in simulated manager, customer, waiter, chef, and driver accounts; alternate customer/driver identities make isolation easy to check. It seeds six orders. The manager can reset development orders and preferences. This reset deletes the development database's orders, so use a separate `PASSCHECK_DATABASE_PATH` for a demo.

Both demo endpoints return 404 under `npm start` / production, even if the environment flag is true. Persisted demo-account sessions are also rejected whenever demo mode is disabled or the server runs in production. Real account permissions come only from the session's database user, never from a selected view, request body, or URL.

## Views and workflows

- **Manager:** all orders in separate In-Person / Online tabs, source/status/fulfillment/UTC-date filters, items/options/notes, customer and staff identities, assignments, locations, timestamps, and recorded history. Can create, prepare, pack, serve, assign, collect, deliver, associate a legacy customer, and cancel with a recorded reason. There is no force-transition override.
- **Customer:** only orders owned by that account, with source, fulfillment, placement time, quantities/options, total, status, and fulfillment-specific progress. Can place online orders. Staff identities, history, other customers, assignments, and packing evidence are excluded from customer API responses.
- **Waiter:** creates in-person orders with quantities/options/notes and an explicit fulfillment method. Can associate a known customer account or submit a guest order. Has Active, Ready to Package, Ready to Serve / Pickup, and Completed sections, separated by source. Starts packaging, checks visible items using the existing photo/manual panel, confirms packing, and chooses Shelf A1/A2. Dine-in orders bypass packaging and are marked served.
- **Chef:** separate source queues, oldest submitted first, with items/options/notes, table, timestamps, and elapsed wait. Starts and finishes preparation. Explicit Reprioritize retains the existing rules / OpenRouter recommendation; it uses persisted queued orders/settings, ignores client-computed durations, and never makes automatic model calls.
- **Driver:** only unassigned deliveries or deliveries assigned to that account. Claims an order before pickup, sees its destination/contact after claim, picks up only a fully checked and packaged ready order, then explicitly marks it delivered. Other drivers cannot read or act on an assigned delivery. Managers can assign/reassign real driver accounts.

Source and fulfillment are separate persisted fields. Source is `IN_PERSON` or `ONLINE`; fulfillment is `DINE_IN`, `TAKEAWAY`, or `DELIVERY`. An in-person order can be takeaway or delivery. The old packing/prioritization types are retained only as adapters; they do not own the new operational status.

```text
Dine-in:  PLACED → PREPARING → READY_TO_SERVE → COMPLETED
Takeaway: PLACED → PREPARING → READY_TO_PACKAGE → PACKAGING → READY_FOR_PICKUP → COMPLETED
Delivery: PLACED → PREPARING → READY_TO_PACKAGE → PACKAGING → READY_FOR_PICKUP → OUT_FOR_DELIVERY → COMPLETED
```

Managers may cancel active orders with a reason. Cancelled/completed orders cannot continue through the workflow. Delivery pickup records actor, assignment, and timestamp and never implies delivery completion. Collection/serving/delivery completion records `completedAt`; history identifies which action completed the order.

## Persistence, permissions, and concurrency

`src/server/database.ts` creates schema migration **1** on first use: users, hashed sessions, bounded sign-in attempts, orders, idempotent requests, and restaurant settings. Passwords use salted scrypt; session cookies are HttpOnly, SameSite Strict, expire after eight hours, and use Secure in production. Logout revokes the server session. Mutations reject cross-origin browser requests.

All order reads, source/fulfillment/status/date filtering, ownership checks, driver assignment checks, workflow validation, checks, totals, and timestamps run on the backend. Staff directory, preferences, prioritization, and photo verification also require appropriate sessions. Customer ownership is applied in SQL before any data is returned. IDs for inaccessible orders return 404.

Order mutations run inside `BEGIN IMMEDIATE` transactions with a revision check. A unique per-user request ID makes repeated successful requests idempotent; stale revisions or conflicting reuse return 409. Each operational action records previous/new status, server timestamp, and actor. Photo checks use current order counts and scan IDs from the server, record results server-side, and reject stale scans. Browser-submitted live matches are not trusted. Manual staff attestations remain explicitly marked manual.

Views poll every four seconds and refresh after actions. Pending actions are disabled; errors and empty/success states are visible. Responses are not cached. Browser localStorage is no longer the authoritative store. Data and sessions survive refreshing the browser and restarting the server.

## Existing demo migration

There was no previous backend or authentication database to migrate. A manager can explicitly choose **Import this browser's previous demo orders** in Manager view. This imports up to 100 valid saved orders using the four current menu IDs. Source and fulfillment map independently; known timestamps are retained, and duplicate imports are skipped.

Unknown customer/staff identities, delivery addresses, historical prices, and totals are marked unavailable rather than invented. Imports contain one honest import event; earlier transitions are not fabricated. Guest/imported orders are invisible to customer accounts until a manager explicitly associates one. Uncollected delivery/takeaway orders require a fresh packing check. A legacy collected delivery becomes Out for delivery, never automatically Delivered. Missing delivery addresses must be confirmed in a staff view before pickup. Dine-in cooking-complete orders become Ready to serve.

The old reducer/localStorage code remains for compatibility and import regression tests. It is not mounted by the authenticated application and cannot bypass the backend.

## Vision and priority integrations

Both services keep `google/gemini-2.5-flash`, structured output, deadlines, validation, and explicit fallbacks. Photo upload remains JPEG/PNG with client resizing and a 4 MiB request limit. No key/provider failure/invalid observation becomes a match. Expected quantities never enter the vision prompt; observed counts are compared in code. Label cards require review and establish no hidden food contents. Checks cannot prove what entered a sealed bag.

Synthetic labeled test images in `tests/fixtures/vision/` are test inputs, not photographs or saved AI responses. Recreate them on Windows with `powershell -File scripts/vision-fixtures.ps1`. Live recognition and model availability are **not verified** without credentials; simulated test results are not live model tests.

Authenticated optional live smoke checks use `PASSCHECK_SMOKE_EMAIL` and `PASSCHECK_SMOKE_PASSWORD` (server-side environment only). Start Next.js with a real OpenRouter key, create relevant test orders, then run:

```sh
# Manager or chef account; at least one placed order in ONLINE (or PASSCHECK_SMOKE_SOURCE).
node scripts/priority-smoke.mjs
# Manager or waiter account; at least one order already in PACKAGING.
node scripts/vision-smoke.mjs path/to/photo.jpg
```

The vision smoke starts a new scan and saves its result to the selected actual order (`PASSCHECK_SMOKE_ORDER` optionally selects the ID). These scripts fail on unavailable live output; they do not certify accuracy or scheduling quality.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

The browser check starts its own production server on an available port using a temporary SQLite database and random test credentials. It uses installed Edge on Windows / Chrome on macOS (`EDGE_PATH` overrides it), and verifies the five views, production demo lockout, actual sign-in/logout, direct API isolation, source tabs, chef preparation, waiter creation and embedded packaging, photo failure/manual fallback, driver claim/pickup/delivery, customer ordering and progress, dine-in serving without packaging, mobile overflow, and persistence across server restart. Screenshots go to ignored `test-results/`. It does not touch your restaurant database or call a live model.
