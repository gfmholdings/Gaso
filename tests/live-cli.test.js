import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const key = 'SYNTHETIC_TEST_KEY_NOT_A_CREDENTIAL';
function run(status = 200) {
  const script = new URL('../tools/live-prices.js', import.meta.url).href;
  const code = `globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const places = body.textQuery === 'gas station'
      ? [{ id: 'missing', location: { latitude: 0, longitude: 0 }, displayName: { text: 'Missing price' },
          fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED' }] } },
         { id: 'invalid', displayName: { text: 'Missing coordinates' } }]
      : [{ location: { latitude: 0, longitude: 0 } }];
    return new Response(JSON.stringify({ places, error: options.headers['X-Goog-Api-Key'] }), { status: ${status} });
  }; await import(${JSON.stringify(script)});`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, PLACES_API_KEY: key },
  });
}

test('live CLI reuses price validation and isolates malformed stations without real API calls', () => {
  const result = run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  const rows = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, 'No live price');
  assert.equal(rows[0].drivingReachability, 'unverified');
  assert.ok(!result.stdout.includes(key));
});

test('live CLI does not echo keys from a provider failure', () => {
  const result = run(403);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Places API 403/);
  assert.ok(!(result.stdout + result.stderr).includes(key));
});
