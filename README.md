# MoGas Plane Gas Finder

MoGas Plane Gas Finder is a small toolchain and web UI that helps pilots find airports that report availability of MoGas (automotive gasoline), 100LL avgas, and Jet-A. The project downloads FAA airport data, parses the fuel information, and publishes a JSON file consumed by a lightweight browser UI in `public/`.

This repository contains:
- `fetch/fetch.go` — a Go program that downloads the FAA NASR airport CSV ZIP (28-day cycle), extracts `APT_BASE.csv`, parses airport rows and fuel types, and writes `public/airports.json`.
- `public/` — static web UI and the generated `airports.json`.
- `js/` — client JavaScript used by the web UI.

What the fetch pipeline does (implementation details)
- The fetch program computes the next FAA NASR cycle date from a fixed anchor date and the 28-day cycle interval. If the "next" cycle is not yet available from the FAA server, it falls back to the current cycle.
- It downloads the ZIP archive for the computed cycle (e.g. `25_Dec_2025_APT_CSV.zip` style filenames), validates it as a ZIP, and extracts `APT_BASE.csv`.
- The CSV parser locates columns such as `ARPT_ID`, `LAT_DECIMAL`, `LONG_DECIMAL`, `ARPT_NAME`, `CITY`, `STATE_CODE`, and `FUEL_TYPES`.
- For each row an airport record is created and written to JSON with this shape:
  ```json
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
- Output location: `public/airports.json`

Why this approach
- The FAA NASR data is authoritative for U.S. airport facility data and is provided in periodic ZIP releases. Automating the fetch, parse, and publish steps ensures the UI reflects recent reporting.
- The fetch pipeline is intentionally simple: download ZIP → extract CSV → parse → produce JSON for the UI.

GitHub Actions / automated monthly updates
- The repository is designed to use GitHub Actions to run the fetching pipeline on a schedule (monthly). The workflow would:
  1. Check out the repository.
  2. Run `go run fetch/fetch.go` (or `go build && ./fetch`) to produce `public/airports.json`.
  3. Commit `public/airports.json` (and any updated assets) and push back to the repository.
- Example GitHub Actions workflow (place it under `.github/workflows/update-nasr.yml`):
  ```yaml
  name: Update NASR (monthly)

  on:
    schedule:
      - cron: '0 3 1 * *'   # run at 03:00 UTC on day 1 of every month
    workflow_dispatch: {}

  jobs:
    update:
      runs-on: ubuntu-latest
      steps:
        - name: Checkout
          uses: actions/checkout@v4

        - name: Set up Go
          uses: actions/setup-go@v4
          with:
            go-version: '1.20' # adjust as needed

        - name: Run fetch program
          run: |
            cd fetch
            go run fetch.go

        - name: Commit generated data
          run: |
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git add public/airports.json
            git commit -m "chore: update NASR airports.json" || echo "no changes to commit"
            git push
          env:
            GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```
- Adjust cron schedule to suit how often you want to refresh; monthly is a reasonable cadence for the 28-day FAA cycle.

Local usage
- To produce the latest `public/airports.json` locally:
  ```
  go run fetch/fetch.go
  ```
  or
  ```
  cd fetch
  go build -o update-nasr
  ./update-nasr
  ```
- After running, open `public/index.html` in a browser (or serve the `public/` folder via a static server) to view the interactive UI.
- If you use the GitHub CLI / git to push, make sure to commit `public/airports.json` (or let the Actions workflow push for you).

Notes on data quality and column mapping
- The CSV parser extracts `FUEL_TYPES` and sets boolean flags for:
  - `mogas` — contains "MOGAS"
  - `100ll` — contains "100" (to detect 100LL)
  - `jet_a` — contains "JET"
- The parser adds `ICAO` by prefixing `K` to the FAA `ARPT_ID`.
- The parser performs basic numeric parsing for lat/lon and assumes the CSV header names match the expected strings.

About MoGas (automotive gasoline) and why it matters
- MoGas refers to automotive-grade gasoline (motor gasoline). Many airports report availability of MoGas for aircraft that are permitted to use it.
- Advantages of using unleaded MoGas where permitted:
  - Cost: MoGas is often substantially cheaper than 100LL avgas.
  - Health and environment: MoGas is typically unleaded and therefore does not release lead emissions when burned, reducing exposure and environmental deposition of lead.
- Important safety and regulatory notes:
  - Not all aircraft or engines are approved to use MoGas. Aircraft certification, engine design, carburetion/fuel system compatibility, and manufacturer/airworthiness directives must be considered.
  - For an aircraft to use automotive gasoline legally, there must be appropriate approval such as a Supplemental Type Certificate (STC), field approval, or manufacturer guidance allowing such fuel for that specific airframe/engine/propeller combination.
  - Fuel volatility, vapor lock risk, and fuel system material compatibility are practical concerns when using automotive gasoline in aircraft.
- Practical recommendation:
  - Where an approved unleaded aviation fuel or an approved MoGas STC exists for your aircraft, switching to an unleaded option can reduce cost and eliminate lead emissions from that aircraft.
  - Always consult the aircraft and engine manuals, STC documentation, and the FAA/EASA guidance before changing fuel types.

Why this tool helps
- This project helps pilots and operators find airports that report MoGas availability so they can plan cost-effective and lower-emission flights when their aircraft permits using unleaded fuel.
- By automating monthly updates from FAA NASR data and publishing `public/airports.json`, the UI stays reasonably current with reported fuel availabilities.

Contributing
- If you want to improve parsing quality, add more fuel types, or enhance the UI:
  - Update `fetch/fetch.go` to handle additional fuel markers or edge cases in the CSV.
  - Update the static site under `public/` and test UI behavior with the generated `airports.json`.
  - Add automated tests for parsing logic where helpful.

License
- Add your preferred license file to the repository (for example MIT or Apache-2.0) to clarify usage and contribution terms.

Acknowledgements and sources
- The FAA NASR (National Airspace System Resources) airport CSV is the source for airport and fuel reporting used by this project.
- For authoritative fuel approvals and operational guidance, consult aircraft manufacturers, engine manufacturers, and the FAA.


## AI use
This project was written with the help of the following AI tools: ChatGPT, GitHub Copilot, and Claude. The design is my own, but much of the actual implementation was through AI.
