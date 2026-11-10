export const EARTH_MILES = 3958.8;
const rad = degrees => degrees * Math.PI / 180;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function validLocation(location) {
  return location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
    && Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180;
}

export function haversine(a, b) {
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude))
    * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}

function bearing(a, b) {
  const d = rad(b.longitude - a.longitude);
  return Math.atan2(Math.sin(d) * Math.cos(rad(b.latitude)),
    Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude))
    - Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(d));
}

/** Distance to the connecting segment, rather than just its endpoints. */
export function corridorDistance(point, a, b) {
  const length = haversine(a, b) / EARTH_MILES;
  if (length < 1e-10) return haversine(point, a);
  const distance = haversine(a, point) / EARTH_MILES;
  const angle = bearing(a, point) - bearing(a, b);
  const along = Math.atan2(Math.sin(distance) * Math.cos(angle), Math.cos(distance));
  if (along < 0 || along > length) return Math.min(haversine(point, a), haversine(point, b));
  return Math.abs(Math.asin(clamp(Math.sin(distance) * Math.sin(angle), -1, 1))) * EARTH_MILES;
}

/** Four-mile gaps cover a three-mile-wide corridor with six-km circles.
 * Refuse overly long searches instead of quietly leaving coverage gaps. */
export function sampleCorridor(a, b) {
  if (!validLocation(a) || !validLocation(b)) throw new Error('The address lookup returned invalid coordinates.');
  const angle = haversine(a, b) / EARTH_MILES;
  const segments = Math.max(4, Math.ceil(angle * EARTH_MILES / 4));
  if (segments >= 80) throw new Error('This trip is too long for a complete prototype search. Use a section shorter than 316 miles.');
  const vector = p => [Math.cos(rad(p.latitude)) * Math.cos(rad(p.longitude)),
    Math.cos(rad(p.latitude)) * Math.sin(rad(p.longitude)), Math.sin(rad(p.latitude))];
  const av = vector(a), bv = vector(b);
  return Array.from({ length: segments + 1 }, (_, i) => {
    if (angle < 1e-10) return { ...a };
    const t = i / segments, left = Math.sin((1 - t) * angle) / Math.sin(angle), right = Math.sin(t * angle) / Math.sin(angle);
    const [x, y, z] = av.map((v, k) => v * left + bv[k] * right);
    return { latitude: Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI, longitude: Math.atan2(y, x) * 180 / Math.PI };
  });
}

export function vehicleRange({ fuel, tank, mpg }) {
  if (![fuel, tank, mpg].every(Number.isFinite) || fuel < 2 || fuel > 100
    || tank < 5 || tank > 40 || mpg < 5 || mpg > 80) {
    throw new Error('Enter fuel from 2–100%, a tank from 5–40 gallons, and MPG from 5–80.');
  }
  return tank * fuel / 100 * mpg;
}

const CLUBS = [
  [/\bcostco\b/i, 'Club membership'],
  [/\bbj[’']?s\b/i, 'Club membership · Club / Club+; check your tier’s pump price'],
  [/\bsam[’']?s club\b/i, 'Club membership'],
];
export function clubTag(name) { return CLUBS.find(([pattern]) => pattern.test(name))?.[1] ?? null; }

export function priceInfo(place, now = Date.now()) {
  const prices = place?.fuelOptions?.fuelPrices;
  const regular = Array.isArray(prices) ? prices.find(f => f?.type === 'REGULAR_UNLEADED') : null;
  const unknown = reason => ({ price: null, updatedAt: null, stale: false, freshness: reason });
  if (!regular?.price || typeof regular.price !== 'object') return unknown('No live price from Google');
  const money = regular.price;
  if (money.currencyCode !== 'USD') return unknown('No comparable USD live price for this station');
  const units = money.units ?? '0', nanos = money.nanos ?? 0;
  if (!/^(0|[1-9]\d*)$/.test(String(units)) || !Number.isSafeInteger(Number(units))
    || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) return unknown('Invalid price data from Google');
  const price = Number(units) + nanos / 1e9;
  if (!Number.isFinite(price) || price <= 0) return unknown('No valid live price from Google');
  const updatedAt = typeof regular.updateTime === 'string' ? Date.parse(regular.updateTime) : NaN;
  if (!Number.isFinite(updatedAt) || updatedAt > now + 5 * 60_000) {
    return { price, updatedAt: null, stale: false, freshness: 'Price freshness unverified — timestamp missing, invalid or in the future' };
  }
  return { price, updatedAt, stale: now - updatedAt > 48 * 36e5, freshness: null };
}

/** Skip malformed records individually; a straight-line lower bound can only
 * rule stations out, never prove that they are reachable by road. */
export function rankStations(places, a, b, range, now = Date.now()) {
  const seen = new Set(), rows = [];
  for (const place of places) {
    if (!place || typeof place.id !== 'string' || !validLocation(place.location) || seen.has(place.id)) continue;
    seen.add(place.id);
    const minimumMiles = haversine(a, place.location);
    if (corridorDistance(place.location, a, b) > 3 || minimumMiles > range) continue;
    rows.push({ id: place.id, name: typeof place.displayName?.text === 'string' ? place.displayName.text : 'Gas station',
      address: typeof place.formattedAddress === 'string' ? place.formattedAddress : '',
      ...priceInfo(place, now), minimumMiles });
  }
  return rows.sort((x, y) => (x.price === null) - (y.price === null)
    || (x.price ?? 0) - (y.price ?? 0) || x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
}
