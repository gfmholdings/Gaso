import assert from 'node:assert/strict';
import test from 'node:test';
import { clubTag, corridorDistance, haversine, priceInfo, rankStations, sampleCorridor, vehicleRange } from '../core.js';

const a = { latitude: 0, longitude: 0 }, b = { latitude: 0, longitude: 4 };
const now = Date.parse('2026-11-10T12:00:00Z');
const fresh = new Date(now - 3600000).toISOString();
const place = (id, price = { currencyCode: 'USD', units: '3', nanos: 500000000 }, updateTime = fresh) => ({
  id, location: a, displayName: { text: id }, fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', price, updateTime }] },
});

test('vehicle range validates finite values and declared bounds', () => {
  assert.ok(Math.abs(vehicleRange({ fuel: 35, tank: 16, mpg: 28 }) - 156.8) < 1e-9);
  assert.equal(vehicleRange({ fuel: 2, tank: 5, mpg: 5 }), 0.5);
  for (const vehicle of [{ fuel: 0, tank: 16, mpg: 28 }, { fuel: 35, tank: -10, mpg: 28 },
    { fuel: 35, tank: 16, mpg: NaN }, { fuel: 101, tank: 16, mpg: 28 }]) assert.throws(() => vehicleRange(vehicle));
});

test('corridor distance measures connecting segments and clamps at both endpoints', () => {
  assert.ok(corridorDistance({ latitude: 0, longitude: 0.5 }, a, b) < 0.001);
  assert.ok(corridorDistance({ latitude: 0.01, longitude: 0.5 }, a, b) > 0.6);
  const before = { latitude: 0, longitude: -1 }, after = { latitude: 0, longitude: 5 };
  assert.equal(corridorDistance(before, a, b), haversine(before, a));
  assert.equal(corridorDistance(after, a, b), haversine(after, b));
  assert.equal(corridorDistance(b, a, a), haversine(b, a));
});

test('corridor sampling covers long trips with bounded gaps and refuses silent truncation', () => {
  const samples = sampleCorridor(a, b);
  assert.ok(samples.length > 5);
  assert.ok(samples.length <= 80);
  for (let i = 1; i < samples.length; i++) assert.ok(haversine(samples[i - 1], samples[i]) <= 4.001);
  assert.ok(haversine(samples[0], a) < 0.001);
  assert.ok(haversine(samples.at(-1), b) < 0.001);
  assert.throws(() => sampleCorridor(a, { latitude: 0, longitude: 20 }), /too long/);
  assert.throws(() => sampleCorridor(a, { latitude: 91, longitude: 0 }), /coordinates/);
});

test('great-circle sampling crosses the date line along the short arc', () => {
  const samples = sampleCorridor({ latitude: 0, longitude: 179 }, { latitude: 0, longitude: -179 });
  assert.ok(samples.every(p => Math.abs(p.longitude) >= 179));
  assert.equal(haversine(a, a), 0);
});

test('invalid, absent, zero and incompatible prices stay unavailable', () => {
  for (const money of [null, {}, { currencyCode: 'USD' }, { currencyCode: 'EUR', units: '3' },
    { currencyCode: 'USD', units: 'NaN' }, { currencyCode: 'USD', units: '-1' },
    { currencyCode: 'USD', units: '3', nanos: 1e9 }]) assert.equal(priceInfo(place('a', money), now).price, null);
  assert.equal(priceInfo({ id: 'missing' }, now).price, null);
  assert.equal(priceInfo(place('a', { currencyCode: 'USD', nanos: 500000000 }), now).price, 0.5);
});

test('freshness handles exact stale boundary, missing, invalid and future timestamps', () => {
  const money = { currencyCode: 'USD', units: '3' };
  assert.equal(priceInfo(place('a', money, new Date(now - 48 * 36e5).toISOString()), now).stale, false);
  assert.equal(priceInfo(place('a', money, new Date(now - 49 * 36e5).toISOString()), now).stale, true);
  for (const timestamp of ['', 'invalid', new Date(now + 86400000).toISOString()]) {
    const info = priceInfo(place('a', money, timestamp), now);
    assert.equal(info.updatedAt, null);
    assert.match(info.freshness, /unverified/);
  }
});

test('ranking skips bad stations, deduplicates, and removes definitely out-of-range candidates', () => {
  const far = { ...place('far', { currencyCode: 'USD', units: '1' }), location: { latitude: 0, longitude: 1 } };
  const rows = rankStations([null, { id: 'bad' }, far, place('known'), place('known'), { ...place('unknown'), fuelOptions: {} }], a, b, 10, now);
  assert.deepEqual(rows.map(p => p.id), ['known', 'unknown']);
  assert.equal(rows[1].price, null);
});

test('a station between old sparse samples is retained on the corridor', () => {
  const between = { ...place('between'), location: { latitude: 0, longitude: 0.5 } };
  assert.equal(rankStations([between], a, b, 157, now)[0].id, 'between');
});

test('club membership tags do not invent a tier discount', () => {
  assert.ok(clubTag('Costco'));
  assert.match(clubTag('BJ’s'), /Club\+/);
  assert.ok(clubTag("Sam's Club"));
  assert.equal(clubTag('Independent'), null);
});
