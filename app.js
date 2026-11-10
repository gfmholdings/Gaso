import { clubTag, priceInfo, rankStations, sampleCorridor, validLocation, vehicleRange } from './core.js';

const $ = id => document.getElementById(id);
const vehicle = () => ({ fuel: Number($('fuel').value), tank: Number($('tank').value), mpg: Number($('mpg').value) });
function updateRange() {
  $('fuelVal').textContent = `${$('fuel').value}%`;
  try { $('rangeVal').textContent = `${vehicleRange(vehicle()).toFixed(0)} miles`; }
  catch { $('rangeVal').textContent = 'Check vehicle values'; }
}
['fuel', 'tank', 'mpg'].forEach(id => $(id).addEventListener('input', updateRange));
updateRange();

// Provider errors are never rendered verbatim: they can contain keys or input.
async function places(body, mask, key, signal) {
  const request = new AbortController();
  const cancel = () => request.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) request.abort();
  const timer = setTimeout(cancel, 15_000);
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', signal: request.signal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const advice = response.status === 403 ? 'Check key restrictions, Places API access and billing.'
        : response.status === 429 ? 'The provider limit was reached. Try later.' : 'Please try again.';
      throw new Error(`Places API ${response.status}. ${advice}`);
    }
    const data = await response.json();
    if (!data || typeof data !== 'object' || (data.places !== undefined && !Array.isArray(data.places))) {
      throw new Error('Google returned an invalid response. Please try again.');
    }
    return data.places ?? [];
  } catch (error) {
    if (request.signal.aborted) throw new Error(signal.aborted ? 'Search cancelled.' : 'Google took too long to respond. Please try again.');
    if (error instanceof TypeError) throw new Error('Could not contact Google. Check your connection and key restrictions.');
    if (error instanceof SyntaxError) throw new Error('Google returned an unreadable response. Please try again.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

async function geocode(query, key, signal) {
  const results = await places({ textQuery: query, maxResultCount: 1 }, 'places.location,places.displayName', key, signal);
  if (!results.length) throw new Error('Could not find that address. Check From and To.');
  if (!validLocation(results[0]?.location)) throw new Error('The address lookup returned invalid coordinates.');
  return results[0].location;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function render(rows) {
  const card = node('div', 'card');
  card.append(node('h2', '', 'Returned USD prices — lowest first'));
  if (!rows.length) card.append(node('p', 'note', 'No stations found in the searched corridor within your estimated range. Try a shorter trip or different addresses. Google may have limited coverage here.'));
  rows.forEach((station, index) => {
    const best = index === 0 && station.price !== null && station.updatedAt !== null && !station.stale;
    const row = node('div', best ? 'station best' : 'station');
    const details = node('div', 'station-details');
    details.append(node('span', 'name', station.name));
    const tag = clubTag(station.name);
    if (tag) details.append(node('span', 'tag', tag));
    details.append(node('div', 'addr', station.address));
    const age = node('div', 'age', station.freshness ?? `Price updated ${new Date(station.updatedAt).toLocaleString()}`);
    if (station.stale) age.append(node('span', 'stale', ' · STALE PRICE'));
    details.append(age, node('div', 'distance', `At least ${station.minimumMiles.toFixed(1)} miles from start. Driving reachability unverified.`));
    row.append(details, node('div', `price${station.price === null ? ' none' : ''}`, station.price === null ? 'No live price' : `$${station.price.toFixed(2)}`));
    card.append(row);
  });
  $('results').replaceChildren(card);
}

let currentSearch = null;
$('cancel').addEventListener('click', () => currentSearch?.abort());
$('go').addEventListener('click', async () => {
  if (currentSearch) return;
  $('err').textContent = '';
  $('status').textContent = '';
  $('results').replaceChildren();
  const key = $('key').value.trim(), from = $('from').value.trim(), to = $('to').value.trim();
  if (!key) { $('err').textContent = 'Paste your Places API key first.'; return; }
  if (!from || !to) { $('err').textContent = 'Enter both From and To before searching.'; return; }
  let range;
  try { range = vehicleRange(vehicle()); }
  catch (error) { $('err').textContent = error.message; return; }
  const controller = new AbortController();
  currentSearch = controller;
  const controls = ['go', 'from', 'to', 'fuel', 'tank', 'mpg', 'key'];
  controls.forEach(id => { $(id).disabled = true; });
  $('cancel').hidden = false;
  $('results').setAttribute('aria-busy', 'true');
  $('status').textContent = 'Looking up the two addresses…';
  // Per-request timeout plus a finite overall search budget.
  let expired = false;
  const deadline = setTimeout(() => { expired = true; controller.abort(); }, 120_000);
  try {
    const a = await geocode(from, key, controller.signal), b = await geocode(to, key, controller.signal);
    const points = sampleCorridor(a, b), seen = new Map();
    let incomplete = '', capped = false;
    for (const [i, point] of points.entries()) {
      if (controller.signal.aborted) throw new Error('Search cancelled.');
      $('status').textContent = `Checking area ${i + 1} of ${points.length} in the approximate corridor…`;
      let found;
      try {
        found = await places({ textQuery: 'gas station', maxResultCount: 20,
          locationBias: { circle: { center: point, radius: 6000 } } },
        'places.id,places.displayName,places.formattedAddress,places.location,places.fuelOptions', key, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || seen.size === 0) throw error;
        incomplete = `Search incomplete: ${error.message} Showing only the areas already checked.`;
        break;
      }
      if (found.length >= 20) capped = true;
      for (const place of found) {
        if (typeof place?.id !== 'string') continue;
        const old = seen.get(place.id);
        // A later duplicate with valid/newer data can replace an incomplete one.
        if (!old || !validLocation(old.location) || (validLocation(place.location)
          && (priceInfo(place).updatedAt ?? 0) > (priceInfo(old).updatedAt ?? 0))) seen.set(place.id, place);
      }
    }
    render(rankStations([...seen.values()], a, b, range));
    const count = $('results').querySelectorAll('.name').length;
    $('status').textContent = `${count} stations in an approximate straight-line corridor. Estimated fuel range: ${range.toFixed(0)} miles. Road route and driving reachability unverified.`;
    if (incomplete) $('err').textContent = incomplete;
    if (capped) $('status').textContent += ' Some search areas reached Google’s result limit; more stations may exist.';
  } catch (error) {
    $('err').textContent = expired ? 'The search reached its two-minute limit. Try a shorter trip.' : error.message;
    $('status').textContent = '';
  } finally {
    clearTimeout(deadline);
    controls.forEach(id => { $(id).disabled = false; });
    $('cancel').hidden = true;
    $('results').setAttribute('aria-busy', 'false');
    currentSearch = null;
  }
});
