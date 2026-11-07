# PassCheck — Wean-9-NOVA-project

Restaurant ordering and handoff workspace with five authenticated views: **Manager, Customer, Waiter, Chef, and Driver**. The top menu keeps role navigation together. Packaging lives inside the Waiter view; managers can perform the same operational actions with the same validation.

The menu is **Burger, Fries, Milkshake, and Salad** (`burger`, `fries`, `milkshake`, `salad`). Demo prices are USD $9, $4, $6, and $7 respectively. Options and preparation notes are free text; options do not add charges. Totals are calculated on the server, with no tax or delivery fees in this prototype.

## Setup

Use **Node.js 24+**. The existing Next.js / React / TypeScript / Zod stack is retained. The Vercel demo stores orders in your browser; a local server uses Node's built-in SQLite. No database service or additional npm dependency is needed for either demo mode.

```sh
npm ci
```

Copy `.env.example` to `.env.local`. Leave `OPENROUTER_API_KEY` blank to use rules prioritization and manual packing. It always stays server-side. For local order storage, set `PASSCHECK_DATABASE_PATH` to a writable persistent file; the default is `data/passcheck.sqlite`.

The five requested fixed accounts are available immediately, including in production builds. No CLI account creation or development-mode flag is required:

| Username | Password | View |
| --- | --- | --- |
| manager | password | Manager (all views) |
| customer | password | Customer |
| waiter | password | Waiter |
| chef | password | Chef |
| driver | password | Driver |

These are shared demonstration identities, not private individual accounts. The login form accepts a username; existing custom account emails continue to work. Fixed credentials and roles are defined server-side in `src/server/fixedAccounts.ts`.

```sh
npm run dev
```

Open http://127.0.0.1:3000 and sign in with one of the usernames above. Optional custom accounts can still be created using the server CLI, which prompts for a password without echoing it (minimum 12 characters):

```sh
npm run account -- --role MANAGER --email manager@example.com --name Manager
npm run account -- --role CUSTOMER --email customer@example.com --name Customer
npm run account -- --role WAITER --email waiter@example.com --name Waiter
npm run account -- --role CHEF --email chef@example.com --name Chef
npm run account -- --role DRIVER --email driver@example.com --name Driver
```

The optional account command loads `.env.local` so it uses the same database as Next.js. For noninteractive custom-account setup, supply `PASSCHECK_ACCOUNT_PASSWORD` through the server environment; never put it in a `NEXT_PUBLIC_` variable or commit it.

**Vercel:** `PASSCHECK_STORAGE_MODE=auto` (the default) selects **browser demo storage** when `VERCEL=1`. The app never creates `/var/task/data` or opens a file database in this mode. If automatic platform detection is unavailable, set `PASSCHECK_STORAGE_MODE=browser_demo` in the Vercel project environment and redeploy. Sign in with the five fixed usernames; no account-creation command is required.

Orders, assignments, preferences, and history are saved together in this browser. Switching roles in the **same browser and site** shares the same demo, including after page refreshes or serverless function restarts. Each browser/site starts independently: this is a single-browser prototype, not synchronized multi-device storage. Use one active tab for the demo. The visible browser-demo banner explains this and lets a manager reset the workspace. Clearing browser storage removes that browser's orders.

Requests carry an encrypted workspace to `/api/browser-demo`. Each request restores it into a fresh **in-memory** repository, runs the existing authorization, ownership, source filtering, revision/idempotency, workflow, priority, and photo-validation handlers, then returns updated encrypted state. No server filesystem write or global order array is involved. Browser reads and writes are serialized so polling cannot overwrite a pending action. Credentials/password hashes and sessions are never included in the workspace. The workspace limit is 200 orders / 2 MiB of plain JSON; requests including a photo are bounded at 4 MiB.

Fixed sessions are signed and expire after eight hours. `PASSCHECK_SESSION_SECRET` optionally replaces the shared demo signing/encryption key; keep the same server-only value across instances/deployments. Changing it invalidates existing demo sessions/workspaces, so sign in again and reset the browser demo if needed. The five credentials remain public demo credentials. Custom email accounts and direct database CLI tools require local SQLite mode.

For production-mode rehearsal: `npm run build`, then `npm start`. Set `PASSCHECK_STORAGE_MODE=browser_demo` to rehearse the Vercel behavior locally. `sqlite` mode requires a persistent writable disk and targets one restaurant on a single Node server; back up that database and its WAL consistently. A shared hosted database is still needed for synchronized orders across different browsers/devices. Production requires HTTPS outside localhost. Local data files are excluded from Git.

On this Windows machine, the portable runtime used for checks is `%TEMP%\passcheck-runtime\node-v24.22.2-win-x64`. If Node is missing from PATH, set `$env:Path = "$env:TEMP\passcheck-runtime\node-v24.22.2-win-x64;$env:Path"` in PowerShell first.

## Development demo identities

Set `PASSCHECK_DEMO_MODE=true` in `.env.local`, then run **`npm run dev`**. The clearly labeled development control signs in simulated manager, customer, waiter, chef, and driver accounts; alternate customer/driver identities make isolation easy to check. It seeds six orders. The manager can reset development orders and preferences. This reset deletes the development database's orders, so use a separate `PASSCHECK_DATABASE_PATH` for a demo.

Both development-switcher endpoints return 404 under `npm start` / production, even if the environment flag is true. Persisted development-switcher sessions are also rejected whenever demo mode is disabled or the server runs in production. The five fixed username/password accounts are separate and remain available in production. Permissions come from server-defined fixed identities or a custom account's database role, never from a selected view, request body, or URL.

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

`src/server/database.ts` creates schema migration **1** on first use: users, hashed sessions, bounded custom-account sign-in attempts, orders, idempotent requests, and restaurant settings. It idempotently registers the five fixed identities for ownership/assignment foreign keys. Custom passwords use salted scrypt; all session cookies are HttpOnly, SameSite Strict, expire after eight hours, and use Secure in production. Custom-account logout revokes the stored session. Fixed-account logout clears the browser cookie; a copied signed demo token remains valid until expiry. Mutations reject cross-origin browser requests.

All order reads, source/fulfillment/status/date filtering, ownership checks, driver assignment checks, workflow validation, checks, totals, and timestamps run on the backend. Staff directory, preferences, prioritization, and photo verification also require appropriate sessions. Customer ownership is applied in SQL before any data is returned. IDs for inaccessible orders return 404.

Order mutations run inside `BEGIN IMMEDIATE` transactions with a revision check. A unique per-user request ID makes repeated successful requests idempotent; stale revisions or conflicting reuse return 409. In browser mode these protections apply to the serialized browser workspace; independent browsers/tabs do not share a central conflict registry. Each operational action records previous/new status, server timestamp, and actor. Photo checks use current order counts and scan IDs from the server, record results server-side, and reject stale scans. Browser-submitted live matches are not trusted. Manual staff attestations remain explicitly marked manual.

Views poll every four seconds and refresh after actions. Pending actions are disabled; errors and empty/success states are visible. Responses are not cached. Local-server mode persists its authoritative orders in SQLite. Vercel/browser mode keeps its server-validated encrypted workspace in localStorage. Both survive refreshing the browser and restarting the server, as long as the relevant database/browser storage and signing key remain available.

## Existing demo migration

There was no previous backend or authentication database to migrate. A manager can explicitly choose **Import this browser's previous demo orders** in Manager view. This imports up to 100 valid saved orders using the four current menu IDs. Source and fulfillment map independently; known timestamps are retained, and duplicate imports are skipped.

Unknown customer/staff identities, delivery addresses, historical prices, and totals are marked unavailable rather than invented. Imports contain one honest import event; earlier transitions are not fabricated. Guest/imported orders are invisible to customer accounts until a manager explicitly associates one. Uncollected delivery/takeaway orders require a fresh packing check. A legacy collected delivery becomes Out for delivery, never automatically Delivered. Missing delivery addresses must be confirmed in a staff view before pickup. Dine-in cooking-complete orders become Ready to serve.

The old reducer/localStorage code remains for compatibility and import regression tests. It is not mounted by the authenticated application and cannot bypass the backend.

## Vision and priority integrations

Both services keep `google/gemini-2.5-flash`, structured output, deadlines, validation, and explicit fallbacks. Photo upload remains JPEG/PNG with client resizing and a 4 MiB request limit. No key/provider failure/invalid observation becomes a match. Expected quantities never enter the vision prompt; observed counts are compared in code. Label cards require review and establish no hidden food contents. Checks cannot prove what entered a sealed bag.

Managers can click **Check AI connection** to validate the deployed server key with OpenRouter's read-only `/api/v1/key` endpoint. This checks authentication/key limits without running a model; acceptance does not prove model/image availability or sufficient account-wide credit. The manager-only app endpoint is `GET /api/ai/status` and works independently of SQLite/browser order storage. It never returns the key, account label, or raw provider body.

AI failures now show safe, actionable reasons rather than a silent generic fallback: rejected key (401), insufficient credits/key budget (402), access/policy denial (403), invalid parameters/schema (400), unavailable model/provider, rate limiting, network failure, timeout, invalid JSON/observations, and truncated output. Priority responses add an optional `diagnostic` while keeping `mode: "fallback"` and valid rules rankings; the model's output schema remains only `requestVersion`/`ranking`. Vision uses its existing `review_needed`/`uncertainties` fields and empty observations on failure. HTTP-200 responses containing an OpenRouter error are treated as failures. Requests are not automatically retried.

`OPENROUTER_API_KEY` is trimmed and accepts a copied surrounding quote pair or `Bearer ` prefix. Embedded whitespace/control characters are rejected before making a request. Vercel logs receive only the feature, classified error code, static guidance, and upstream HTTP status; raw provider messages, prompts, photos, exception text, and authorization headers are never logged. Set the actual key in Vercel's environment for the deployed environment and redeploy—editing `.env.example` does not configure the hosted server.

Synthetic labeled test images in `tests/fixtures/vision/` are test inputs, not photographs or saved AI responses. Recreate them on Windows with `powershell -File scripts/vision-fixtures.ps1`. Live recognition and model availability are **not verified** without credentials; simulated test results are not live model tests.

Authenticated optional CLI live smoke checks target **local SQLite mode**, using `PASSCHECK_SMOKE_EMAIL` and `PASSCHECK_SMOKE_PASSWORD` (server-side environment only). Start Next.js with a real OpenRouter key, create relevant test orders, then run:

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

The browser check starts its own production server on an available port, first using a temporary SQLite database and random test credentials. It uses installed Edge on Windows / Chrome on macOS (`EDGE_PATH` overrides it), and verifies the five views, production development-switcher lockout, fixed/custom sign-in/logout, direct API isolation, source tabs, chef preparation, waiter creation and embedded packaging, photo failure/manual fallback, driver claim/pickup/delivery, customer ordering and progress, dine-in serving, mobile overflow, and server-restart persistence. It then restarts with `VERCEL=1`, auto storage selection, and a database path whose directory must never be created. It repeats the full browser-stored delivery journey, prioritization, photo fallback/manual checks, role switches, restart/refresh restoration, mobile banner, and reset, and verifies that no application database directory was created. Screenshots go to ignored `test-results/`. It does not touch your restaurant database or call a live model.
