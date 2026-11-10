# Gaso audit fixes

The original two-file browser prototype was audited at `2f38601`. Its 34
browser checks had 17 failures. The repaired browser app passes those checks
plus seven additional cases: **41 browser checks, 11 JavaScript tests and four
Python launcher tests pass**.

## Changes

- Provider text uses DOM text nodes. Station names/addresses cannot inject HTML.
  Scripts are external modules protected by a restrictive Content Security Policy.
- Estimated fuel range is validated. Definitely out-of-range stations are removed
  using a straight-line lower bound; remaining stations are explicitly unverified
  for driving reachability. Unsupported Maps/car-integration claims are removed.
- Corridor checks measure distance to the connecting segment, not just sample
  points. Queries use at most four-mile spacing, with an explicit long-trip limit
  instead of silent gaps. This remains a straight-line approximation, not routing.
- Missing, malformed, zero or non-USD prices are unavailable. Missing/invalid/future
  timestamps are unverified. Stale data is marked and not highlighted as verified.
- Input validation happens before API requests; inputs are held constant during
  searches. One malformed station does not discard valid results.
- Provider errors never echo raw response bodies or keys. Late failures preserve
  valid partial results with warnings. Result caps are disclosed.
- Every request has a 15-second timeout. A search has a two-minute budget and a
  working Cancel button; completion/error/cancel paths restore the controls.
- Labels are associated with inputs, status/errors are announced, empty results
  explain the outcome, and long provider names wrap on narrow mobile screens.
- Unit/browser regression suites, a lockfile and GitHub Actions checks are included.
- The concurrent key-safe Python diagnostic is preserved as a launcher. Its Node
  helper reuses the validated corridor/price core instead of duplicating the old
  sparse-sampling and missing-price bugs. Offline tests cover key handling and
  provider failures without making live calls.

## Verification

`npm run check`, `npm test`, `npm run test:launcher`, and
`CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`
pass locally. Chromium 156 runs the real UI and modules against mocked Google
responses; no Google traffic, real credentials or API charges are used by tests.
`npm audit` reports zero dependency advisories at verification time. Screenshots
and JSON browser results are written to the ignored `test-results/` directory.

The previously supplied live key is not embedded in code or tests. A prior
two-request smoke check established Places address/fuel-field access only.
The repaired browser flow has not been checked with a rotated live key, and
browser CORS, real station coverage and actual pump prices remain unverified.
No native overlay, active Maps route feed, vehicle telemetry, CarPlay/Android
Auto integration or road-distance reachability is implemented by these fixes.
