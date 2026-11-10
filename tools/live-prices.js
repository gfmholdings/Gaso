// Optional diagnostic, never run by the offline regression suite.
// The Python launcher supplies the key via the environment, not command args.
import { priceInfo, rankStations, sampleCorridor, validLocation } from '../core.js';

const key = process.env.PLACES_API_KEY?.trim();
async function search(body, mask) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Places API ${response.status}. Check access, restrictions and billing.`);
  const data = await response.json();
  if (!data || typeof data !== 'object' || (data.places !== undefined && !Array.isArray(data.places))) {
    throw new Error('Google returned an invalid response.');
  }
  return data.places ?? [];
}
async function locate(query) {
  const matches = await search({ textQuery: query, maxResultCount: 1 }, 'places.location');
  if (!validLocation(matches[0]?.location)) throw new Error('Could not find valid coordinates for an address.');
  return matches[0].location;
}
async function main() {
  if (!key || key === 'paste-your-key-here') throw new Error('Set PLACES_API_KEY to a valid key before running a live check.');
  const from = process.argv[2] ?? '282 Poquonock Ave, Windsor, CT';
  const to = process.argv[3] ?? 'Fountain Village, Manchester, CT';
  if (!from.trim() || !to.trim()) throw new Error('From and To must both be nonempty.');
  const a = await locate(from), b = await locate(to), points = sampleCorridor(a, b), found = new Map();
  console.error(`Checking ${points.length} areas (billable requests). Approximate corridor only; driving reachability unverified.`);
  let capped = false;
  for (const point of points) {
    const places = await search({ textQuery: 'gas station', maxResultCount: 20,
      locationBias: { circle: { center: point, radius: 6000 } } },
    'places.id,places.displayName,places.formattedAddress,places.location,places.fuelOptions');
    if (places.length >= 20) capped = true;
    for (const place of places) {
      if (typeof place?.id !== 'string') continue;
      const old = found.get(place.id);
      if (!old || !validLocation(old.location) || (validLocation(place.location)
        && (priceInfo(place).updatedAt ?? 0) > (priceInfo(old).updatedAt ?? 0))) found.set(place.id, place);
    }
  }
  // No vehicle values were supplied to this diagnostic, so it makes no range filter claim.
  const rows = rankStations([...found.values()], a, b, Infinity);
  if (!rows.length) console.log('No stations found in the searched corridor. Provider coverage may be limited.');
  for (const row of rows) {
    console.log(JSON.stringify({ name: row.name, address: row.address,
      price: row.price === null ? 'No live price' : `USD ${row.price.toFixed(2)}`,
      freshness: row.freshness ?? new Date(row.updatedAt).toISOString(), stale: row.stale,
      drivingReachability: 'unverified' }));
  }
  if (capped) console.error('Some areas reached the provider result limit; this list is not exhaustive.');
}
try { await main(); }
catch (error) {
  const message = error.name === 'TimeoutError' ? 'Google took too long to respond.'
    : error instanceof TypeError ? 'Could not contact Google. Check connectivity and key restrictions.'
    : error instanceof SyntaxError ? 'Google returned an unreadable response.' : error.message;
  console.error(key ? message.split(key).join('[REDACTED]') : message);
  process.exitCode = 1;
}
