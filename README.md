# Gaso — gas price comparison prototype

Gaso is a browser prototype that compares provider-reported regular-unleaded
USD prices near a straight-line corridor between two addresses. It estimates
fuel range from manually entered vehicle values.

**It does not overlay Google Maps, read another app's active navigation, connect
to a vehicle, or guarantee road-route reachability or the cheapest station.**

## Run locally

Serve this directory over HTTP; ES modules will not work by opening the HTML
as a `file://` URL:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`. Enter a restricted Google Places API (New) key in
the password field. Gaso keeps it in the current page only; it is not saved to
storage, written into the URL, or included in errors. Do not commit keys or
paste real keys into test fixtures. If a key has been shared publicly, rotate
it in Google Cloud and set appropriate API/application restrictions and quotas.

Each search performs two address lookups and 5–80 station-area queries. These
may be billable. Searches use denser sampling for longer corridors; trips over
316 straight-line miles must be split into shorter sections. There is a
15-second timeout per request, a two-minute overall limit, and a Cancel button.

## What the results mean

- Stations are checked against the connecting corridor, including between
  sample points, rather than only against five distant points.
- Straight-line distance can exclude a station that is definitely beyond the
  estimated range. A station that remains is **not proven reachable by road**.
  Check the actual road route, station access and fuel needs; keep a reserve.
- Returned USD prices are sorted numerically, with missing, invalid and
  non-USD prices last as “No live price.” Prices are not invented.
- A price older than 48 hours is flagged stale. Missing, invalid or implausibly
  future timestamps are explicitly unverified. A stale or unverified price is
  not highlighted as a verified best price.
- Club stations receive membership tags without changing the ranking. Confirm
  your membership tier's price and the quoted pump unit at the station.
- Google may omit stations or prices. Result-cap warnings and partial-search
  failures are shown explicitly. The list is not exhaustive.
- All provider names and addresses are rendered as text. A malformed station
  is skipped without discarding valid results. Inputs are labeled for assistive
  technology, and status/errors are announced.

The original prototype's historical test prices are not current price quotes.
A November 10, 2026 live API smoke check confirmed address lookup and fuel fields;
that does not establish live browser CORS, exhaustive coverage or road routing.

## Tests

Node.js 22+ is recommended. The application has no runtime npm dependencies;
Playwright is used only for browser tests.

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

To use an existing system Chromium:

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

The browser suite serves the real HTML and modules locally and intercepts every
nonlocal request. It uses a synthetic key and controlled Google fixtures, so
it makes no Google calls and incurs no API charges. JSON results and screenshots
are written to the ignored `test-results/` directory. GitHub Actions runs syntax,
core and browser regression checks and uploads browser artifacts.

## Maps and native-app roadmap

The current web app has no Maps overlay or navigation handoff. An Android
version could explore an overlay with explicit permission; that would not by
itself grant access to Google Maps' active route. iPhone apps generally cannot
float over another app. A future native version can investigate supported
navigation handoff, actual road-route calculation and available vehicle APIs.
CarPlay/Android Auto telemetry and access to another app's navigation must be
validated before they are promised as features.

See [FIXES.md](FIXES.md) for the audit changes and remaining validation limits.
