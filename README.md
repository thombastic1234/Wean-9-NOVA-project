# PassCheck

Wean-9-NOVA-project

Person 1's hackathon app: unified waiter/online queue → cooking → packing check → assigned location → ready → collected. One restaurant, one active browser tab, six seeded orders, four menu IDs, no database or authentication.

## Run locally

Install Node.js 24 LTS (Node 20.9+ supported), then from this folder:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. No API key is needed for the manual demo. For production-mode rehearsal: `npm run build`, then `npm start`.

If Node is unavailable on PATH in this Windows session, the verified portable runtime used during implementation is at `%TEMP%\passcheck-runtime\node-v24.22.2-win-x64`. In PowerShell, set `$env:Path = "$env:TEMP\passcheck-runtime\node-v24.22.2-win-x64;$env:Path"`, then run the commands above. This temporary path is specific to this machine.

## What is connected

- Both mock source buttons add orders to the same queue. Mock courier arrival updates priority inputs.
- Shared reducer/context owns every status, timestamp, verification, packing confirmation, location, and pickup code.
- Six fresh relative-time orders seed the first load. Browser localStorage restores orders/preferences before any write. Reset replaces saved orders and clears checks, ranking, and preferences.
- Readiness requires correct observed counts (`match` or `manual_checked`), packing confirmation, and an allowed location. Table destination stays separate from the kitchen pass.
- Packing uses an explicitly labeled **manual checklist**. There is no photo/camera implementation in Person 1's temporary component.
- `/api/prioritize` is a **demo arrival-order stub** returning `mode: "fallback"`; it does not score orders or call AI. Preferences are saved and sent using the agreed request shape.
- `/api/verify` validates the request, then returns **503**. It never invents vision results. AI and vision logic remain with Persons 2 and 4.

## Team integration

Contracts are in `src/lib/contracts.ts`; catalog IDs/names are in `src/lib/catalog.ts`. No alternate shared contract existed in the empty workspace. The catalog is deliberately a skeleton; Person 4 supplies visual descriptions. IDs stay `burger`, `fries`, `cola`, `cookie`.

**Person 2:** replace `src/app/api/prioritize/route.ts` with the real service and deterministic fallback. `PriorityControls` is supplied by Person 1; replace its presentation if needed while keeping `settings` and `onChange`. Remove its temporary demo-only note after integration. The client sends queued orders only, validates complete unique rankings, aborts after eight seconds, and rejects stale `requestVersion` results. Versions change on queued membership, courier arrival, settings, reset, and a 30-second clock refresh. The outage adapter preserves incoming order without implementing your fallback scoring.

**Person 3:** replace `src/components/PackingPanel.tsx`, retaining `order`, `onVerificationUpdate`, and `onPackingConfirmed`. One necessary addition to the suggested boundary is **`onScanStarted(scanId)`**: call it before every new photo/check to clear old verification and confirmation. A callback carrying only the final result cannot tell the store which in-flight result is obsolete. Store only transient camera/photo/loading state locally. The parent keys the component by order/reset so switching orders cannot copy checklist state. Call `onVerificationUpdate` with the agreed response plus `checkedAt`. Generate a fresh scanId for every photo change, rescan, and manual recheck. API failure, timeout, or invalid output should show manual fallback; never synthesize `match`. Manual completion must explicitly account for all counts and no extra items.

**Person 4:** replace `src/app/api/verify/route.ts` and extend catalog descriptions without changing IDs. Keep expected quantities out of the model prompt; compare them in code after recognition. Use `visionResponseSchema` at the boundary. API results exclude `manual_checked` (app state only). Definite missing/extra counts take precedence; otherwise unknown items/uncertainties require review. Only visible counts can match; opaque containers and sealed bag contents are not established.

Persons 2/4 must test the actual OpenRouter endpoint with `google/gemini-2.5-flash` for availability, image input, and structured output in Hour 1. Those live checks are **not completed by this Person 1 implementation**. Keep `OPENROUTER_API_KEY` in server-only route code and `.env.local`; never use `NEXT_PUBLIC_`. `.env.example` is a placeholder and no secret is required by current stubs.

## Predictable two-minute demo

1. Click **Reset demo**, then confirm. The first queue ticket is `ON-1041`.
2. Add one **Waiter order** and one **Online order** to show unified ingestion.
3. On `ON-1041`, click **Start cooking**, then **Finish cooking**. Point out that it is still not ready.
4. In Packing check, inspect and tick each visible item, then click **Complete manual check**. State clearly that this is a staff check.
5. Tick the staff packing/sealing confirmation. Select **Shelf A1**. Click **Mark ready for pickup**.
6. Show `ON-1041`, pickup code `PON1041`, and **Shelf A1** together. Refresh: location and check persist.
7. Click **Mark collected**. The ticket leaves the pickup board.
8. Optional dine-in example: start a waiter order and use **Pass 1**; its table remains a separate destination.

Demo codes identify tickets and provide no authentication. Do not claim live AI, guaranteed response speed, recognition accuracy, contents of opaque containers, or proof of sealed bag contents.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

Tests cover reducer transition guards, full pickup journey, duplicate ingestion, stale ranking/scan results, changed checks revoking confirmation, mismatch/review handling, invalid match counts, locations, persistence, reset, malformed API requests, and honest unconnected endpoint responses. The demo assumes one active tab; cross-tab synchronization is outside scope.

An optional Windows browser smoke check uses installed Edge and Node's built-in WebSocket, with no extra dependency. Start the app, then run `node scripts/browser-smoke.mjs`. Set `EDGE_PATH` to override the browser executable. It verifies both sources, the manual journey, blocked readiness, refresh persistence, collection, reset, mobile overflow, and browser errors. Screenshots are written to the ignored `test-results/` folder. A separate temporary browser profile keeps your normal browsing data untouched.

Implementation validation: 18 tests passed, TypeScript passed, production build passed, and the browser journey passed. Live AI/vision testing remains with Persons 2/4.
