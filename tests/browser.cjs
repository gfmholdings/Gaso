// Browser regressions against the real Gaso UI. Google is intercepted;
// the API key is synthetic, and no requests are sent to Google.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = process.env.GASO_ROOT || path.resolve(__dirname, '..');
const out = path.join(root, 'test-results');
fs.mkdirSync(out, { recursive: true });
const now = Date.parse('2026-11-10T12:00:00Z');
const fresh = new Date(now - 3600000).toISOString();
const station = (id, price = 3.5, extra = {}) => ({
  id, displayName: { text: id }, formattedAddress: '1 Main Street',
  location: { latitude: 0, longitude: 0 },
  fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED',
    price: { currencyCode: 'USD', units: String(Math.floor(price)), nanos: Math.round((price % 1) * 1e9) },
    updateTime: fresh }] }, ...extra,
});

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const allowed = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/core.js': 'core.js' };
    const file = allowed[pathname];
    if (file) {
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
      res.end(fs.readFileSync(path.join(root, file)));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    async function check(name, fn, opts = {}) {
      const context = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
      const requests = [], errors = [];
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(t => { Date.now = () => t; }, now);
      if (opts.init) await page.addInitScript(opts.init);
      let geocodes = 0, scans = 0;
      await page.route('**/*', async route => {
        const req = route.request();
        if (req.url().startsWith(origin)) return route.continue();
        if (!req.url().startsWith('https://places.googleapis.com/v1/places:searchText')) return route.abort();
        const body = req.postDataJSON();
        requests.push({ body, headers: req.headers() });
        const search = body.textQuery === 'gas station';
        if (search) scans++; else geocodes++;
        if (opts.api) {
          const custom = await opts.api({ search, geocodes, scans, body });
          if (custom?.abort) return route.abort();
          if (custom) return route.fulfill({ status: custom.status || 200, contentType: 'application/json', body: JSON.stringify(custom.json) });
        }
        const json = search ? { places: opts.stations || [station('Example Gas')] }
          : { places: [{ location: geocodes === 1 ? (opts.start || { latitude: 0, longitude: 0 }) : (opts.end || { latitude: 0, longitude: 0.02 }) }] };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
      });
      try {
        await page.goto(origin);
        const search = async () => {
          await page.fill('#key', 'AUDIT_FAKE_KEY_NOT_A_CREDENTIAL');
          await page.click('#go');
          await page.waitForFunction(() => !document.getElementById('go').disabled);
        };
        await fn({ page, search, requests, errors });
        assert.deepEqual(errors, [], 'The browser must not have uncaught script errors');
        results.push({ name, status: 'PASS' });
      } catch (e) {
        results.push({ name, status: 'FAIL', error: e.message });
        await page.screenshot({ path: path.join(out, `failure-${results.length}.png`), fullPage: true });
      } finally { await context.close(); }
      console.log(`${results.at(-1).status}: ${name}`);
    }
    const names = page => page.locator('#results .name').allTextContents();
    const prices = page => page.locator('#results .price').allTextContents();

    await check('Initial fuel range is 157 miles', async ({ page }) => {
      assert.equal(await page.textContent('#rangeVal'), '157 miles');
    });
    await check('Changing simulated vehicle inputs updates range', async ({ page }) => {
      await page.fill('#tank', '10'); await page.fill('#mpg', '20');
      await page.locator('#fuel').evaluate(el => { el.value = '50'; el.dispatchEvent(new Event('input')); });
      assert.equal(await page.textContent('#rangeVal'), '100 miles');
    });
    await check('Missing API key stops network requests', async ({ page, requests }) => {
      await page.click('#go'); assert.match(await page.textContent('#err'), /Paste your Places API key/);
      assert.equal(requests.length, 0);
    });
    await check('Price sorting, deduplication and unknown-price ordering', async ({ page, search, requests }) => {
      await search(); assert.deepEqual(await names(page), ['Cheap', 'Expensive', 'Unknown']);
      assert.equal(requests.length, 7); assert.deepEqual(await prices(page), ['$3.10', '$4.20', 'No live price']);
    }, { stations: [station('Expensive', 4.2), station('Unknown', 0, { fuelOptions: {} }), station('Cheap', 3.1)] });
    await check('Club labels do not personalize price ranking', async ({ page, search }) => {
      await search(); assert.deepEqual(await names(page), ['Costco', "BJ's", "Sam's Club", 'Independent']);
      assert.equal(await page.locator('#results .tag').count(), 3);
    }, { stations: [station('Independent', 4), station("Sam's Club", 3.8), station("BJ's", 3.6), station('Costco', 3.4)] });
    await check('Absent fuel data is displayed as No live price', async ({ page, search }) => {
      await search(); assert.deepEqual(await prices(page), ['No live price']);
    }, { stations: [station('Unknown', 0, { fuelOptions: undefined })] });
    await check('Prices older than 48 hours are flagged stale', async ({ page, search }) => {
      await search(); assert.equal(await page.locator('.stale').count(), 1);
    }, { stations: [station('Old', 3, { fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', price: { currencyCode: 'USD', units: '3' }, updateTime: new Date(now - 49 * 36e5).toISOString() }] } })] });
    await check('Exactly 48 hours is not incorrectly marked older than 48', async ({ page, search }) => {
      await search(); assert.equal(await page.locator('.stale').count(), 0);
    }, { stations: [station('Boundary', 3, { fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', price: { currencyCode: 'USD', units: '3' }, updateTime: new Date(now - 48 * 36e5).toISOString() }] } })] });
    await check('Stations outside the sampled corridor are excluded', async ({ page, search }) => {
      await search(); assert.deepEqual(await names(page), ['Nearby']);
    }, { stations: [station('FarAway', 2, { location: { latitude: 2, longitude: 2 } }), station('Nearby', 4)] });
    await check('Google 403 is displayed and button becomes usable again', async ({ page, search }) => {
      await search(); assert.match(await page.textContent('#err'), /Places API 403/);
      assert.equal(await page.locator('#go').isEnabled(), true);
    }, { api: async () => ({ status: 403, json: { error: { message: 'Mock denied' } } }) });
    await check('Empty geocode response gives a recoverable error', async ({ page, search }) => {
      await search(); assert.match(await page.textContent('#err'), /Could not find/);
    }, { api: async () => ({ json: { places: [] } }) });
    await check('Network failure is displayed and button recovers', async ({ page, search }) => {
      await search(); assert.ok((await page.textContent('#err')).length > 0);
      assert.equal(await page.locator('#go').isEnabled(), true);
    }, { api: async () => ({ abort: true }) });
    await check('No API key is saved in browser storage or URL', async ({ page, search }) => {
      await search();
      assert.deepEqual(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookie: document.cookie })), { local: [], session: [], cookie: '' });
      assert.equal(page.url().includes('AUDIT_FAKE'), false);
    });
    await check('Mobile viewport has no horizontal overflow', async ({ page, search }) => {
      await search(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
    }, { mobile: true });

    await check('Station name is rendered as text, never executable HTML', async ({ page, search }) => {
      await search(); await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => !!window.auditNameXss), false);
      assert.equal(await page.locator('#results img').count(), 0);
      assert.match(await page.textContent('#results'), /<img src=x/);
    }, { stations: [station('payload', 3, { displayName: { text: '<img src=x onerror="window.auditNameXss=true">' } })] });
    await check('Station address is rendered as text, never executable HTML', async ({ page, search }) => {
      await search(); await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => !!window.auditAddressXss), false);
      assert.equal(await page.locator('#results img').count(), 0);
      assert.match(await page.textContent('#results'), /<img src=x/);
    }, { stations: [station('Address Payload', 3, { formattedAddress: '<img src=x onerror="window.auditAddressXss=true">' })] });
    await check('Stations beyond the vehicle range are not called reachable', async ({ page, search }) => {
      await page.fill('#tank', '5'); await page.fill('#mpg', '5');
      await page.locator('#fuel').evaluate(el => { el.value = '2'; el.dispatchEvent(new Event('input')); });
      await search();
      const shown = await names(page), status = await page.textContent('#status');
      assert.ok(!shown.includes('Beyond Range') || !status.includes('all are within reach'), 'A station 69 miles away is marked reachable with 0.5 miles of fuel');
    }, { end: { latitude: 0, longitude: 1 }, stations: [station('Beyond Range', 2, { location: { latitude: 0, longitude: 1 } })] });
    await check('Invalid vehicle input prevents a search', async ({ page, search, requests }) => {
      await page.fill('#tank', '-10'); await search();
      assert.equal(requests.length, 0, 'Negative tank size must not produce a valid station ranking');
    });
    await check('Empty origin prevents a search', async ({ page, search, requests }) => {
      await page.fill('#from', ''); await search(); assert.equal(requests.length, 0);
    });
    await check('Missing Money payload is not shown as free gas', async ({ page, search }) => {
      await search(); assert.ok(!(await prices(page)).includes('$0.00'));
    }, { stations: [station('No Money', 0, { fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', updateTime: fresh }] } })] });
    await check('Missing price timestamp is explicitly reported', async ({ page, search }) => {
      await search(); assert.match(await page.locator('#results .age').innerText(), /unknown|unavailable|unverified|no live price/i);
    }, { stations: [station('No Timestamp', 3, { fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', price: { currencyCode: 'USD', units: '3' } }] } })] });
    await check('Invalid timestamp is not treated as verified current data', async ({ page, search }) => {
      await search(); assert.doesNotMatch(await page.locator('#results .age').innerText(), /Invalid Date/);
    }, { stations: [station('Bad Timestamp', 3, { fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', price: { currencyCode: 'USD', units: '3' }, updateTime: 'not-a-date' }] } })] });
    await check('Non-USD price is not silently relabeled as USD', async ({ page, search }) => {
      await search(); assert.ok(!(await prices(page)).includes('$3.00'));
    }, { stations: [station('Euro Station', 3, { fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', price: { currencyCode: 'EUR', units: '3' }, updateTime: fresh }] } })] });
    await check('Malformed station cannot discard every valid result', async ({ page, search }) => {
      await search(); assert.ok((await names(page)).includes('Good Station'));
    }, { stations: [station('Bad Station', 2, { location: undefined }), station('Good Station', 4)] });
    await check('Station on corridor between sparse sample points is retained', async ({ page, search }) => {
      await search(); assert.ok((await names(page)).includes('On Corridor'));
    }, { end: { latitude: 0, longitude: 4 }, stations: [station('On Corridor', 3, { location: { latitude: 0, longitude: 0.5 } })] });
    await check('Empty results give an explicit no-stations message', async ({ page, search }) => {
      await search(); assert.match(await page.textContent('#results'), /no stations|none found|no gas stations|no results/i);
    }, { stations: [] });
    await check('Form inputs have programmatic labels', async ({ page }) => {
      assert.equal(await page.getByLabel('From', { exact: true }).count(), 1);
      assert.equal(await page.getByLabel('Tank size (gal)', { exact: true }).count(), 1);
    });
    await check('API error messages do not expose the submitted key', async ({ page, search }) => {
      await search(); assert.ok(!(await page.textContent('#err')).includes('AUDIT_FAKE_KEY_NOT_A_CREDENTIAL'));
    }, { api: async () => ({ status: 400, json: { error: { message: 'Rejected key AUDIT_FAKE_KEY_NOT_A_CREDENTIAL' } } }) });

    await check('Only regular-unleaded prices are used', async ({ page, search }) => {
      await search(); assert.deepEqual(await prices(page), ['$3.50']);
    }, { stations: [station('Mixed Fuels', 0, { fuelOptions: { fuelPrices: [
      { type: 'DIESEL', price: { currencyCode: 'USD', units: '2' }, updateTime: fresh },
      { type: 'REGULAR_UNLEADED', price: { currencyCode: 'USD', units: '3', nanos: 500000000 }, updateTime: fresh },
    ] } })] });
    await check('API response HTML is shown as text in the error UI', async ({ page, search }) => {
      await search(); await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => !!window.auditErrorXss), false);
    }, { api: async () => ({ status: 500, json: { error: '<img src=x onerror="window.auditErrorXss=true">' } }) });
    await check('A failed request can be retried successfully', async ({ page, search }) => {
      await search(); assert.match(await page.textContent('#err'), /500/);
      await search(); assert.equal(await page.textContent('#err'), '');
      assert.deepEqual(await names(page), ['Example Gas']);
    }, { api: async ({ geocodes }) => geocodes === 1 ? { status: 500, json: { error: 'Transient failure' } } : null });
    await check('Non-numeric Money is not presented as a gas price', async ({ page, search }) => {
      await search(); assert.ok(!(await prices(page)).includes('$NaN'));
    }, { stations: [station('Bad Price', 3, { fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', price: { currencyCode: 'USD', units: 'invalid' }, updateTime: fresh }] } })] });
    await check('Implausibly future price timestamps are flagged', async ({ page, search }) => {
      await search(); assert.match(await page.locator('#results .age').innerText(), /unknown|unverified|future|invalid|no live price/i);
    }, { stations: [station('Future Price', 3, { fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', price: { currencyCode: 'USD', units: '3' }, updateTime: new Date(now + 7 * 24 * 36e5).toISOString() }] } })] });
    await check('Results remain usable on mobile with a long station name', async ({ page, search }) => {
      await search(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }, { mobile: true, stations: [station('A'.repeat(180))] });

    await check('Unsafe long-trip coverage is rejected explicitly before station requests', async ({ page, search, requests }) => {
      await search();
      assert.match(await page.textContent('#err'), /too long/);
      assert.equal(requests.filter(r => r.body.textQuery === 'gas station').length, 0);
    }, { end: { latitude: 0, longitude: 20 } });
    await check('A late provider error keeps valid partial results with a clear warning', async ({ page, search }) => {
      await search();
      assert.deepEqual(await names(page), ['Example Gas']);
      assert.match(await page.textContent('#err'), /Search incomplete/);
    }, { api: async ({ search, scans }) => search && scans === 2 ? { status: 503, json: { error: 'Mock unavailable' } } : null });
    await check('Per-area result caps are disclosed rather than called exhaustive', async ({ page, search }) => {
      await search();
      assert.match(await page.textContent('#status'), /result limit/);
      assert.equal((await names(page)).length, 20);
    }, { stations: Array.from({ length: 20 }, (_, i) => station(`Station ${i}`)) });
    await check('Vehicle and route inputs are held constant during a search', async ({ page, search }) => {
      const running = search();
      await page.waitForSelector('#cancel:visible');
      assert.equal(await page.locator('#from').isDisabled(), true);
      assert.equal(await page.locator('#tank').isDisabled(), true);
      await running;
      assert.equal(await page.locator('#from').isEnabled(), true);
    }, { api: async ({ geocodes, search }) => {
      if (!search && geocodes === 1) await new Promise(resolve => setTimeout(resolve, 200));
      return null;
    } });
    await check('Cancel aborts the pending request and allows a new search', async ({ page, search }) => {
      const running = search();
      await page.waitForSelector('#cancel:visible');
      await page.click('#cancel');
      await running;
      assert.match(await page.textContent('#err'), /cancelled/);
      assert.equal(await page.locator('#go').isEnabled(), true);
      await page.waitForTimeout(350);
      await search();
      assert.equal(await page.textContent('#err'), '');
    }, { api: async ({ geocodes, search }) => {
      if (!search && geocodes === 1) await new Promise(resolve => setTimeout(resolve, 300));
      return null;
    } });
    await check('Per-request timeout recovers the UI when Google stalls', async ({ page, search }) => {
      await search();
      assert.match(await page.textContent('#err'), /too long to respond/);
      assert.equal(await page.locator('#go').isEnabled(), true);
      await page.waitForTimeout(300);
    }, {
      init: () => {
        const original = window.setTimeout;
        window.setTimeout = (callback, ms, ...args) => original(callback, ms === 15000 ? 50 : ms, ...args);
      },
      api: async () => { await new Promise(resolve => setTimeout(resolve, 250)); return null; },
    });
    await check('Overall search deadline is distinguished from user cancellation', async ({ page, search }) => {
      await search();
      assert.match(await page.textContent('#err'), /two-minute limit/);
      assert.equal(await page.locator('#go').isEnabled(), true);
      await page.waitForTimeout(300);
    }, {
      init: () => {
        const original = window.setTimeout;
        window.setTimeout = (callback, ms, ...args) => original(callback, ms === 120000 ? 50 : ms, ...args);
      },
      api: async () => { await new Promise(resolve => setTimeout(resolve, 250)); return null; },
    });

    const summary = { commit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), workingTree: 'tested including local fixes', browser: browser.version(),
      total: results.length, passed: results.filter(r => r.status === 'PASS').length,
      failed: results.filter(r => r.status === 'FAIL').length, results };
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(summary, null, 2));
    console.log(`\n${summary.passed}/${summary.total} passed; ${summary.failed} failed`);
    if (summary.failed) process.exitCode = 1;
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
