# PassCheck

Wean-9-NOVA-project

Hackathon app with Person 1's workflow and Person 2's prioritization: unified waiter/online queue → cooking → packing check → assigned location → ready → collected. One restaurant, one active browser tab, six seeded orders, four menu IDs, no database or authentication.

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
- Packing supports JPEG/PNG upload, a resized photo preview, explicit photo checks and rechecks, and a **manual checklist** with a separate no-extras confirmation. A photo change clears the old check and packing confirmation immediately. Webcam capture remains optional and is not implemented.
- `/api/prioritize` uses deterministic weighted rules without a key. With a server key it requests a structured OpenRouter recommendation, validates version and complete unique IDs, enforces maximum wait in code, and falls back on failures or an eight-second deadline. Preferences persist using the agreed shape.
- The queue shows reasons and **AI recommendation / Rules fallback active**. **Reprioritize** is the only API trigger; no automatic calls or retries. Tickets stay actionable during loading, duplicate clicks are blocked, and the store rejects stale results. Changing queued inputs/settings immediately exposes current rules.
- `/api/verify` validates JPEG/PNG requests up to 4 MB, requests structured visible counts from OpenRouter, and compares quantities in code. No key, timeout, API failure, or invalid observations returns `review_needed` with no fabricated counts. Manual checking remains available.

## Team integration

Contracts are in `src/lib/contracts.ts`; catalog IDs/names are in `src/lib/catalog.ts`. No alternate shared contract existed in the empty workspace. The catalog includes visual descriptions for visible food and labeled demo props. IDs stay `burger`, `fries`, `milkshake`, `salad`.

The test menu is **Burger, Fries, Milkshake, and Salad**. Saved demos containing menu IDs outside this catalog load fresh demo orders on refresh; old packing checks are never reused for the replacement items.

**Person 2 delivered:** `src/app/api/prioritize/route.ts`, server-only usage of `src/lib/priorityService.ts`, browser-safe pure helpers in `src/lib/priority.ts`, `src/lib/priorityClient.ts`, `usePriority`, and settings controls. `PriorityControls` retains `settings` / `onChange`. `usePriority()` returns `{ ranking, loading, error, reprioritize, overAiLimit }`; the board uses this ranking so rules are available even if the local server is offline. Person 1's reducer, ingestion, status transitions, and order schema are unchanged. `requestVersion` changes on queued membership, courier arrival, settings, reset, and explicit Reprioritize (which refreshes durations). The old 30-second automatic API refresh was removed; display clocks still update.

The existing default weights **3 / 5 / 4** and maximum wait **20 minutes** are retained. Existing weight range **0–10** is retained and now requires integers; maximum wait remains an integer **5–120 minutes**. Request validation additionally rejects empty/duplicate IDs, and response reasons must be nonempty and at most 240 characters. These are validation refinements to the existing contract, not new response fields.

Rules compute `slack = minutesUntilTargetReady - estimatedPrepMinutes` and `score = ageWeight * min(max(ageMinutes, 0) / 20, 1) + urgencyWeight * clamp((10 - slack) / 10, 0, 1) + courierWeight * min(max(courierWaitingMinutes, 0) / 10, 1)`. Orders at or beyond maximum wait go first, oldest first. Remaining orders sort by descending score, descending age, then stable ID. These constants are demo choices, not validated restaurant optimization. Queues larger than ten stay entirely on rules rather than dropping tickets or sending more than ten to AI.

**Person 3 delivered:** `src/components/PackingPanel.tsx` and `src/lib/packingClient.ts`, retaining `order`, `onVerificationUpdate`, and `onPackingConfirmed`. One necessary addition to the suggested boundary is **`onScanStarted(scanId)`**: call it before every new photo/check to clear old verification and confirmation. A callback carrying only the final result cannot tell the store which in-flight result is obsolete. Store only transient camera/photo/loading state locally. The parent keys the component by order/reset so switching orders cannot copy checklist state. Call `onVerificationUpdate` with the agreed response plus `checkedAt`. Generate a fresh scanId for every photo change, rescan, and manual recheck. API failure, timeout, or invalid output should show manual fallback; never synthesize `match`. Manual completion must explicitly account for all counts and no extra items.

**Person 4 delivered:** `src/app/api/verify/route.ts`, `src/lib/visionService.ts`, catalog visual descriptions, acceptance tests, labeled PNG fixtures, and a live smoke script. IDs and response fields are unchanged. Keep expected quantities out of the model prompt; compare them in code after recognition. Use `visionResponseSchema` at the boundary. API results exclude `manual_checked` (app state only). Definite missing/extra counts take precedence; otherwise unknown items/uncertainties require review. Only visible counts can match; opaque containers and sealed bag contents are not established.

Live prioritization is fixed to `google/gemini-2.5-flash`, with server-side POST to `/api/v1/chat/completions`, strict JSON schema, and `provider.require_parameters=true`, following [OpenRouter's structured-output documentation](https://openrouter.ai/docs/guides/features/structured-outputs). Server code attaches `mode`; the model only returns `requestVersion` and `ranking`. All three weights and slack are explained in the prompt; durations come from app code, and order records are treated as data. There is no retry loop.

**Live text/structured-output testing remains unverified:** no key was available and the user requested implementation/local checks without one. To run it later, copy `.env.example` to `.env.local`, set `OPENROUTER_API_KEY`, restart Next.js, then run `node scripts/priority-smoke.mjs`. It sends the D104/T021/T018 fixtures through the real route and fails if it receives fallback; mocks never count as a passed live test. Keep the key server-side, never in `NEXT_PUBLIC_`. Image-input testing remains Person 4's responsibility.

Priority demo: T018 is 22 minutes old and must lead under the 20-minute hard rule. D104 has 4 minutes until target and needs 6 minutes prep (slack **−2 minutes**) plus a courier waiting 3 minutes. Under the retained defaults its rules score is **8.00**, ahead of T021 at **2.70**. The fixture test verifies `T018 → D104 → T021`. Explain the preference-based recommendation without claiming optimal scheduling or measured time savings.

## Predictable two-minute demo

1. Click **Reset demo**, then confirm. The first queue ticket is `ON-1041`.
2. Add one **Waiter order** and one **Online order** to show unified ingestion.
3. On `ON-1041`, click **Start cooking**, then **Finish cooking**. Point out that it is still not ready.
4. In Packing check, optionally upload a JPEG/PNG and click **Check photo**. Without a server key, the endpoint honestly shows **Review needed** with manual fallback. Inspect and tick each expected quantity plus **No extra items are present**, then click **Complete manual check**. State clearly that this is a staff check.
5. Tick **I packed the checked items.** Select **Shelf A1**. Click **Mark ready for pickup**.
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

Tests cover reducer transition guards, full pickup journey, duplicate ingestion, stale ranking/scan results, changed checks revoking confirmation, mismatch/review handling, invalid match counts, locations, persistence, reset, malformed API requests, fallback scores and ties, maximum wait, all weights, invalid AI IDs/versions/JSON, HTTP/network failures, server/client timeout, oversized queues, and vision comparison, validation, size limits, timeout, and honest review fallback. AI responses in unit/browser tests are explicitly simulated fixtures, not live provider validation. The demo assumes one active tab; cross-tab synchronization is outside scope.

An optional browser smoke check uses installed Chrome on macOS or Edge on Windows, and Node's built-in WebSocket, with no extra dependency. Start the app **without an API key** for this deterministic test, then run `node scripts/browser-smoke.mjs`. Set `EDGE_PATH` to override the browser executable. It verifies explicit priority requests, no overlap, stale response rejection, an actionable queue during loading, both sources, the manual journey, blocked readiness, refresh persistence, collection, reset, mobile overflow, and browser errors. Screenshots are written to the ignored `test-results/` folder. A separate temporary browser profile keeps your normal browsing data untouched.

Person 2 validation: **31 tests passed**, TypeScript passed, production build passed, and the extended Edge browser journey passed (including explicit requests, overlap prevention, stale results, mobile overflow, and the full manual pickup flow). No dependencies were changed. Live AI/vision testing remains unverified without credentials.

## Packing integration and verification

The panel retains Person 1's exact callbacks: `onScanStarted(scanId)`, `onVerificationUpdate(verification)` (including `checkedAt`), and `onPackingConfirmed(confirmed)`. Only the shared reducer owns verification, confirmation, and order status. Photo data and pending/manual inputs are transient; photos are not stored in localStorage. Revisiting an order restores its authoritative check and explains when its photo is no longer available in the view.

Upload accepts JPEG/PNG up to 20 MB and 40 megapixels, resizes the longest edge to at most 1024 px, and sends JPEG to the agreed `/api/verify` contract only on an explicit click. The client rejects invalid JSON/schema, wrong order/scan IDs, unsupported success counts, and HTTP/network errors. Requests have a 15-second deadline; duplicate submissions are blocked. Photo changes, manual edits, and new scans invalidate old results and packing confirmation. Switching orders aborts pending work and clears transient evidence. Rescans replace counts. No webcam permission is requested; uploading and manual checking work without camera access.

Person 4 implemented the real endpoint. Without credentials it returns a normalized **Review needed** response with manual fallback available. Local simulated test responses are never production vision results. Label-based checks must be disclosed during the demo.

Person 3 checks: TypeScript, 36 unit tests, and production build passed. The extended browser smoke check covers upload/resizing, the real missing-key review fallback, simulated mismatch-to-match replacement, duplicate clicks, stale photo/order responses, manual no-extras confirmation, invalid images, timeouts, and mobile packing layout. No live vision recognition has been validated.


## Person 4: vision handoff

`POST /api/verify` retains the agreed response and echoes server-owned order/scan IDs. The existing packing UI consumes it without callback changes. Valid provider observations are compared per image; scans never accumulate detections. Missing/extra counts take precedence, otherwise unknowns/uncertainties require review. Only unobscured, matching counts with no uncertainty can match. Labels always require staff review and establish no hidden contents.

The shared request validator now accepts only JPEG/PNG and positive integer expected quantities. Repeated expected IDs aggregate, up to 100 per menu ID. Model observations must contain unique catalog IDs and nonnegative integer counts up to 100. The whole encoded JSON request is bounded at 4 MiB, even without Content-Length; image signatures and canonical base64 are checked. This is lightweight input validation, not a complete image decoder; corrupt image contents rejected by the provider become review_needed. Existing browser preparation resizes uploads to 1024 px.

The server sends only the full catalog and one image to `google/gemini-2.5-flash`; expected quantities, order IDs, and scan IDs never enter the model prompt. It requests strict structured output with parameter-compatible routing and validates the result locally. There are no automatic retries. The 12-second deadline covers fetch and body parsing. Provider errors, missing key, malformed/duplicate observations, and truncated output return HTTP 200 with `review_needed`, an explanation, and empty count arrays. Invalid requests return 400; oversized requests return 413. The packing client already maps these to manual review.

Provider format references: [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs) and [image inputs](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding). Actual model/provider image and schema support remains unverified until the live smoke test passes.

Fixtures in `tests/fixtures/vision/` are **synthetic label cards**, not real food photos or prerecorded AI results. Each expected order is burger x1, fries x1, milkshake x1:

| Input | Visible cards | Expected handling |
| --- | --- | --- |
| correct.png | BURGER, FRIES, MILKSHAKE | Counts agree; label uncertainty requires review |
| missing.png | BURGER, MILKSHAKE | Missing fries; mismatch |
| extra.png | BURGER, FRIES, MILKSHAKE, SALAD | Extra salad; mismatch |
| unclear.png | BURGER, FRIES, MILKSHAKE, ??? | Unknown card; review |

Recreate fixtures on Windows with `powershell -File scripts/vision-fixtures.ps1`. Use these as image inputs, or photograph actual demo props laid out separately in good light. Before rehearsal, compare catalog descriptions against the team's actual props. Do not claim these fixtures validate food recognition.

For a live check, copy `.env.example` to `.env.local`, set the server-only key, restart the app, then run:

```sh
node scripts/vision-smoke.mjs
# Or provide a real photo (expected burger/fries/milkshake x1):
node scripts/vision-smoke.mjs path/to/photo.jpg
```

The smoke test fails on fallback/no observations. It prints fresh normalized counts for inspection and does not certify accuracy. No key was available during implementation, so no live model recognition has been validated. If recognition is unreliable by Hour 3, use the disclosed label props or manual checklist. No dependencies were added or changed.


Person 4 validation: **46 tests passed**, `npm run typecheck` passed, and `npm run build` passed. The Edge browser smoke passed upload/resizing, real missing-key review, simulated mismatch/match rescans, stale response rejection, manual checklist and pickup journey, persistence, and mobile layout. `node scripts/vision-smoke.mjs` was run and correctly failed with no recognized observations because no server key was configured. This is not a passed live API test. The provider tests use simulated responses only.
