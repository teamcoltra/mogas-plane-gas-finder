# MoGas Plane Gas Finder

A focused, production-ready toolchain and static UI for locating U.S. airports that report MoGas (motor gasoline), 100LL avgas, and Jet‑A. The project automates downloading FAA NASR data, extracts fuel availability, and publishes a compact JSON file consumed by a fast browser UI under `public/`.



---

## Overview

The core responsibilities of this project:

- Fetch FAA NASR 28‑day cycle ZIPs that contain `APT_BASE.csv`.
- Extract and parse airport rows to identify reported fuel types.
- Produce `public/airports.json` (compact and client-friendly).
- Serve a static UI at `public/index.html` that reads the JSON and provides filtering and mapping.

Design goals: correctness, transparency, and a simple CI flow to keep data fresh.

---

## Repository layout

- `fetch/` — Go tool that downloads the NASR ZIP, extracts `APT_BASE.csv`, parses rows, and emits `public/airports.json`. Main entry: `fetch/fetch.go`.
- `public/` — static site assets (HTML/CSS/JS) and generated `airports.json`.
- `public/js/` — client-side JavaScript for map, filters, and paging.
- `.github/workflows/` — GitHub Actions workflows for data updates and Pages deployment.

---

## Quick start

Generate the dataset locally and preview the static site.

```/dev/null/commands.sh#L1-6
# Generate airports.json locally
cd fetch
go run fetch.go

# Serve the static site from `public`:
cd public
python3 -m http.server 8000
# open http://localhost:8000 in your browser
```

---

## Data pipeline (how it works)

The `fetch` program implements a compact, auditable pipeline:

1. Compute the next FAA NASR cycle date (NA SR cycles are 28 days).
2. Attempt to download the ZIP for the next cycle; if it is not yet available, fall back to the current cycle.
3. Validate the ZIP file and extract `APT_BASE.csv`.
4. Parse the CSV header and rows; derive fields and set boolean flags for fuel availability.
5. Write `public/airports.json`.

The implementation is intentionally straightforward (download → validate → extract → parse → emit) so behavior is easy to inspect and test.

---

## Data model

Each airport entry is compact and designed for client-side filtering:

```/dev/null/example.json#L1-16
{
  "arpt_id": "ABC",
  "name": "Example Airport",
  "city": "Somewhere",
  "state": "XX",
  "icao": "KABC",
  "lat": 12.3456,
  "lon": -98.7654,
  "fuel": {
    "mogas": true,
    "100ll": false,
    "jet_a": false
  }
}
```

Parser notes:

- Fuel detection uses substring checks in `FUEL_TYPES`:
  - `MOGAS` → `mogas: true`
  - `100` (covers `100LL`) → `100ll: true`
  - `JET` → `jet_a: true`
- `ICAO` is constructed as `K` + `ARPT_ID`.
- Latitude and longitude are parsed from `LAT_DECIMAL` and `LONG_DECIMAL`.


---

## About MoGas — practical guidance

**What**: MoGas is automotive motor gasoline. For some aircraft and engines — with proper approvals or STCs — MoGas may be used as an unleaded alternative.

**Why consider it**:
- Cost: often cheaper than 100LL.
- Health: unleaded fuels reduce lead emissions and local exposure.


## License & acknowledgements

- See [LICENSE](LICENSE) for license details.
- Data source: FAA NASR (APT_BASE.csv inside 28-day cycle ZIPs).
- Tooling: Go for data processing; small JS + Leaflet front end for mapping.

---

## AI Disclaimer
This project was built using AI tools and techniques. The design was desgined by me, the project idea and things were designed by me. Most impelmenation was done by AI.
