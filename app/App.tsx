import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Station = {
  name: string;
  address: string;
  price: number | null;
  updatedAt: string | null;
};

const KEY_STORAGE = 'gaso_places_key';

const CLUB_TAGS: { re: RegExp; tag: string }[] = [
  { re: /costco/i, tag: 'Club membership' },
  { re: /bj'?s/i, tag: 'Club membership · two tiers: Club and Club+ (Club+ earns an extra 5¢/gal off)' },
  { re: /sam'?s club/i, tag: 'Club membership' },
];

function clubTag(name: string): string | null {
  for (const c of CLUB_TAGS) if (c.re.test(name)) return c.tag;
  return null;
}

type LatLng = { lat: number; lng: number };

function haversineMi(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const dLa = ((b.lat - a.lat) * Math.PI) / 180;
  const dLo = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Distance from point p to segment a-b, in miles (straight-line approximation).
function segmentDistanceMi(p: LatLng, a: LatLng, b: LatLng): number {
  const ax = a.lng, ay = a.lat, bx = b.lng, by = b.lat, px = p.lng, py = p.lat;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return haversineMi(p, { lat: ay + t * dy, lng: ax + t * dx });
}

async function placesSearch(body: object, mask: string, key: string): Promise<any> {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': mask,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Places API error (${r.status}). Check the API key.`);
  return r.json();
}

async function geocode(query: string, key: string): Promise<LatLng> {
  const res = await placesSearch(
    { textQuery: query, maxResultCount: 1 },
    'places.location,places.displayName',
    key,
  );
  const loc = res?.places?.[0]?.location;
  if (!loc) throw new Error(`Could not find: ${query}`);
  return { lat: loc.latitude, lng: loc.longitude };
}

function parsePrice(place: any): { price: number | null; updatedAt: string | null } {
  for (const f of place?.fuelOptions?.fuelPrices ?? []) {
    if (f?.type !== 'REGULAR_UNLEADED') continue;
    const units = Number(f?.price?.units ?? NaN);
    const nanos = Number(f?.price?.nanos ?? 0);
    const currency = f?.price?.currencyCode;
    if (!Number.isFinite(units) || (currency && currency !== 'USD')) return { price: null, updatedAt: null };
    const price = units + nanos / 1e9;
    if (!(price > 0)) return { price: null, updatedAt: null };
    return { price, updatedAt: typeof f?.updateTime === 'string' ? f.updateTime : null };
  }
  return { price: null, updatedAt: null };
}

export default function App() {
  const [fuelPct, setFuelPct] = useState('35');
  const [tank, setTank] = useState('16');
  const [mpg, setMpg] = useState('28');
  const [from, setFrom] = useState('282 Poquonock Ave, Windsor, CT');
  const [to, setTo] = useState('Fountain Village, Manchester, CT');
  const [apiKey, setApiKey] = useState('');
  const [stations, setStations] = useState<Station[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY_STORAGE).then((v) => {
      if (v) setApiKey(v);
    });
  }, []);

  const rangeMi = useMemo(() => {
    const f = parseFloat(fuelPct) / 100;
    const t = parseFloat(tank);
    const m = parseFloat(mpg);
    if (![f, t, m].every(Number.isFinite)) return null;
    return (t * f * m).toFixed(0);
  }, [fuelPct, tank, mpg]);

  async function runCheck() {
    setError('');
    setStations(null);
    setStatus('');
    const key = apiKey.trim();
    if (!key) {
      setError('Paste your Google Places API key first.');
      return;
    }
    setLoading(true);
    try {
      await AsyncStorage.setItem(KEY_STORAGE, key);
      const a = await geocode(from, key);
      const b = await geocode(to, key);
      const samples: LatLng[] = [];
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        samples.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      }
      const seen = new Map<string, any>();
      for (const p of samples) {
        const res = await placesSearch(
          {
            textQuery: 'gas station',
            maxResultCount: 20,
            locationBias: { circle: { center: { latitude: p.lat, longitude: p.lng }, radius: 6000 } },
          },
          'places.id,places.displayName,places.formattedAddress,places.location,places.fuelOptions',
          key,
        );
        for (const pl of res?.places ?? []) if (pl?.id && !seen.has(pl.id)) seen.set(pl.id, pl);
      }
      const rows: Station[] = [];
      for (const pl of seen.values()) {
        const loc: LatLng = { lat: pl.location.latitude, lng: pl.location.longitude };
        if (segmentDistanceMi(loc, a, b) > 3) continue;
        const { price, updatedAt } = parsePrice(pl);
        rows.push({
          name: pl?.displayName?.text ?? 'Gas station',
          address: pl?.formattedAddress ?? '',
          price,
          updatedAt,
        });
      }
      rows.sort((x, y) => {
        if (x.price === null && y.price === null) return 0;
        if (x.price === null) return 1;
        if (y.price === null) return -1;
        return x.price - y.price;
      });
      setStations(rows);
      setStatus(
        `${rows.length} stations near your route` +
          (rangeMi ? ` · your range is about ${rangeMi} miles` : ''),
      );
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          <Text style={styles.h1}>⛽ Gaso</Text>
          <Text style={styles.sub}>
            Cheapest live gas on your route. In the full app, direction comes from your Maps
            navigation and fuel &amp; mileage from the car itself — this build takes both as
            inputs.
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Vehicle</Text>
            <View style={styles.row}>
              <View style={styles.field}>
                <Text style={styles.label}>Fuel level %</Text>
                <TextInput style={styles.input} value={fuelPct} onChangeText={setFuelPct} keyboardType="numeric" />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Tank (gal)</Text>
                <TextInput style={styles.input} value={tank} onChangeText={setTank} keyboardType="numeric" />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>MPG</Text>
                <TextInput style={styles.input} value={mpg} onChangeText={setMpg} keyboardType="numeric" />
              </View>
            </View>
            <Text style={styles.note}>
              Range remaining: {rangeMi ? `${rangeMi} miles` : '—'}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Route</Text>
            <Text style={styles.label}>From</Text>
            <TextInput style={styles.input} value={from} onChangeText={setFrom} />
            <Text style={styles.label}>To</Text>
            <TextInput style={styles.input} value={to} onChangeText={setTo} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Live prices (Google Places)</Text>
            <Text style={styles.label}>Places API key — saved on this device only</Text>
            <TextInput
              style={styles.input}
              value={apiKey}
              onChangeText={setApiKey}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Paste API key"
              placeholderTextColor="#5b6b7a"
            />
            <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={runCheck} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#14100a" />
              ) : (
                <Text style={styles.buttonText}>Check live prices on my route</Text>
              )}
            </Pressable>
            {!!status && <Text style={styles.note}>{status}</Text>}
            {!!error && <Text style={styles.error}>{error}</Text>}
          </View>

          {stations && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Ranked — cheapest first</Text>
              {stations.map((s, i) => {
                const tag = clubTag(s.name);
                let age = '';
                let stale = false;
                if (s.updatedAt) {
                  const hrs = (Date.now() - new Date(s.updatedAt).getTime()) / 36e5;
                  stale = hrs > 48;
                  age = `Price updated ${new Date(s.updatedAt).toLocaleString()}`;
                }
                return (
                  <View key={i} style={[styles.station, i === 0 && s.price !== null && styles.best]}>
                    <View style={styles.stationMain}>
                      <Text style={styles.name}>
                        {s.name}
                        {tag ? <Text style={styles.tag}> {tag}</Text> : null}
                      </Text>
                      <Text style={styles.addr}>{s.address}</Text>
                      <Text style={styles.addr}>
                        {s.price !== null ? age : 'Google has no live price for this station'}
                        {stale ? <Text style={styles.stale}> · STALE PRICE</Text> : null}
                      </Text>
                    </View>
                    <Text style={[styles.price, s.price === null && styles.priceNone]}>
                      {s.price !== null ? `$${s.price.toFixed(2)}` : 'No live price'}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          <Text style={styles.note}>
            Everyone sees the same price-ranked list. Club stations are tagged, never
            personalized. A price older than 48 hours is flagged stale. A station with no live
            price is never estimated.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1419' },
  wrap: { padding: 20, paddingBottom: 48 },
  h1: { fontSize: 26, fontWeight: '800', color: '#e8edf2' },
  sub: { color: '#9fb0c0', fontSize: 14, marginTop: 4, marginBottom: 16, lineHeight: 20 },
  card: {
    backgroundColor: '#18202a',
    borderWidth: 1,
    borderColor: '#26303d',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#cfe0f2',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  row: { flexDirection: 'row', gap: 10 },
  field: { flex: 1 },
  label: { fontSize: 12.5, color: '#9fb0c0', marginTop: 8, marginBottom: 4 },
  input: {
    backgroundColor: '#0f1419',
    borderWidth: 1,
    borderColor: '#33404f',
    borderRadius: 10,
    color: '#e8edf2',
    padding: 10,
    fontSize: 15,
  },
  note: { fontSize: 12.5, color: '#8fa2b5', lineHeight: 18, marginTop: 8 },
  error: { color: '#ff7b72', fontSize: 13.5, marginTop: 8 },
  button: {
    backgroundColor: '#ffb300',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#14100a', fontSize: 16, fontWeight: '700' },
  station: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#26303d',
  },
  best: { borderWidth: 1, borderColor: '#7ee787', borderRadius: 10, padding: 12 },
  stationMain: { flex: 1 },
  name: { fontWeight: '700', color: '#e8edf2', fontSize: 15 },
  tag: { color: '#ffd54f', fontSize: 11.5, fontWeight: '700' },
  addr: { fontSize: 12.5, color: '#9fb0c0', marginTop: 2 },
  stale: { color: '#ff9e64', fontWeight: '700' },
  price: { fontSize: 21, fontWeight: '800', color: '#7ee787' },
  priceNone: { color: '#5b6b7a', fontSize: 13.5, fontWeight: '600' },
});
