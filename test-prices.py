#!/usr/bin/env python3
"""Gaso live price test — regular unleaded along a route corridor.

Reads the API key from the PLACES_API_KEY environment variable or a local
.env file (never commit the key). Usage:
    python3 test-prices.py "282 Poquonock Ave, Windsor, CT" "Fountain Village, Manchester, CT"
Defaults to that Windsor -> Manchester test route.
"""
import json, math, os, sys, urllib.request

def load_key():
    k = os.environ.get("PLACES_API_KEY")
    if k: return k
    if os.path.exists(".env"):
        for line in open(".env"):
            if line.strip().startswith("PLACES_API_KEY="):
                return line.strip().split("=", 1)[1].strip()
    sys.exit("No PLACES_API_KEY found. Put it in the environment or a local .env file.")

KEY = load_key()

def post(path, body, mask):
    req = urllib.request.Request("https://places.googleapis.com/v1/" + path,
                                 data=json.dumps(body).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Goog-Api-Key", KEY)
    req.add_header("X-Goog-FieldMask", mask)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def geocode(q):
    res = post("places:searchText", {"textQuery": q, "maxResultCount": 1},
               "places.location")
    loc = res["places"][0]["location"]
    return loc["latitude"], loc["longitude"]

def hav(a, b):
    R = 3958.8
    dla, dlo = math.radians(b[0]-a[0]), math.radians(b[1]-a[1])
    h = math.sin(dla/2)**2 + math.cos(math.radians(a[0]))*math.cos(math.radians(b[0]))*math.sin(dlo/2)**2
    return 2*R*math.asin(math.sqrt(h))

def main():
    start = sys.argv[1] if len(sys.argv) > 1 else "282 Poquonock Ave, Windsor, CT"
    dest  = sys.argv[2] if len(sys.argv) > 2 else "Fountain Village, Manchester, CT"
    a, b = geocode(start), geocode(dest)
    pts = [(a[0]+(b[0]-a[0])*i/4, a[1]+(b[1]-a[1])*i/4) for i in range(5)]
    seen = {}
    for lat, lng in pts:
        res = post("places:searchText",
                   {"textQuery": "gas station", "maxResultCount": 20,
                    "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 6000.0}}},
                   "places.id,places.displayName,places.formattedAddress,places.location,places.fuelOptions")
        for p in res.get("places", []):
            seen[p["id"]] = p
    rows = []
    for p in seen.values():
        loc = (p["location"]["latitude"], p["location"]["longitude"])
        if min(hav(pt, loc) for pt in pts) > 3: continue
        price, upd = None, None
        for f in (p.get("fuelOptions") or {}).get("fuelPrices", []):
            if f.get("type") == "REGULAR_UNLEADED":
                pr = f.get("price") or {}
                price = float(pr.get("units", "0")) + pr.get("nanos", 0)/1e9
                upd = f.get("updateTime")
        rows.append((price, (p.get("displayName") or {}).get("text", "?"), p.get("formattedAddress", ""), upd))
    rows.sort(key=lambda r: (r[0] is None, r[0] or 0))
    for price, name, addr, upd in rows:
        print(f"{('$%.2f' % price) if price is not None else 'NO PRICE'} | {name} | {addr} | updated: {upd}")

if __name__ == "__main__":
    main()
