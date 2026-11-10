# Gaso — Cheapest Gas Ahead

A phone app that rides alongside the maps app you're already using and finds
the cheapest gas on your way — before you need it.

## How it works

1. **Direction comes from Maps.** The app takes the active route from the
   navigation already running in Google Maps / Apple Maps (CarPlay /
   Android Auto). It doesn't ask you to plan a second trip inside a second app.
2. **Vehicle data comes from the car itself.** Fuel level and MPG are read
   from the vehicle over CarPlay / Android Auto, so the app always knows the
   real range remaining. Manual entry is friction — it's the fallback, not
   the design.
3. **Live prices only.** Station prices come from Google's live feed
   (Places API, `fuelOptions`), each with its own last-updated timestamp.
   A price older than 48 hours is flagged **stale**; a station with no live
   price is shown with **"No live price"** — never an estimate.
4. **One honest ranking.** Everyone sees the same price-ranked list along the
   route, filtered to what the car can actually reach. Club stations
   (Costco, BJ's, Sam's Club) carry a small **"club membership"** tag —
   BJ's tag notes its two tiers (Club / Club+) — but the ranking is never
   personalized.

## Prototype

`index.html` is a working phase-1 prototype (A→B route check):

- Simulates the vehicle feed (fuel level, tank size, MPG) to show the
  range math the car will supply automatically.
- Geocodes the start/destination, samples the corridor, and pulls live
  regular-unleaded prices with timestamps from the Places API.
- Paste a Google Places API (New) key in the page — it lives only in the
  tab, is never saved, and is **not** committed to this repo.

First live test (2026-11-10, Windsor CT → Manchester CT): Costco South
Windsor $3.85/gal was cheapest on the corridor; BJ's Manchester returns no
fuel prices from Google and is listed as "No live price".

## Roadmap

- **Phase 1** — A→B check with live prices (this prototype).
- **Phase 2** — Live mode: route + fuel read continuously from the car;
  proactive "cheaper gas ahead, within your range" nudge as fuel drops.

## Repo

Public prototype under GFM Holdings. Not yet an App Store build.
