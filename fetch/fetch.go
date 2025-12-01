package main

import (
	"archive/zip"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

//
// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

type Airport struct {
	ArptID string          `json:"arpt_id"`
	Name   string          `json:"name"`
	City   string          `json:"city"`
	State  string          `json:"state"`
	ICAO   string          `json:"icao"`
	Lat    float64         `json:"lat"`
	Lon    float64         `json:"lon"`
	Fuel   map[string]bool `json:"fuel"`
}

//
// -----------------------------------------------------------------------------
// CONSTANTS
// -----------------------------------------------------------------------------

// FAA NASR known anchor cycle date
// This corresponds to: 25_Dec_2025_APT_CSV.zip
var anchorDate = time.Date(2025, 12, 25, 0, 0, 0, 0, time.UTC)

const cycleLengthDays = 28

//
// -----------------------------------------------------------------------------
// MAIN ENTRY
// -----------------------------------------------------------------------------

func main() {
	fmt.Println("[INFO] Calculating NASR cycle dates...")

	nextCycle := computeNextCycle()
	nextURL := formatZipURL(nextCycle)

	fmt.Println("[INFO] Trying NEXT cycle:", nextURL)

	// Try downloading NEXT cycle
	err := download(nextURL, "cycle.zip")
	if err != nil || !isZipValid("cycle.zip") {
		fmt.Println("[WARN] Next cycle not available. Falling back to CURRENT cycle.")

		os.Remove("cycle.zip")

		currentCycle := nextCycle.Add(-cycleLengthDays * 24 * time.Hour)
		currentURL := formatZipURL(currentCycle)

		fmt.Println("[INFO] Current cycle URL:", currentURL)

		err2 := download(currentURL, "cycle.zip")
		if err2 != nil {
			panic(fmt.Errorf("failed to download current cycle: %w", err2))
		}

		if !isZipValid("cycle.zip") {
			panic("Downloaded current cycle but it is NOT a valid ZIP.")
		}
	}

	runPipeline("cycle.zip")
}

//
// -----------------------------------------------------------------------------
// CYCLE CALCULATION
// -----------------------------------------------------------------------------

func computeNextCycle() time.Time {
	now := time.Now().UTC()

	daysSinceAnchor := now.Sub(anchorDate).Hours() / 24
	n := int(daysSinceAnchor/float64(cycleLengthDays)) + 1

	return anchorDate.Add(time.Duration(n*cycleLengthDays) * 24 * time.Hour)
}

func formatZipURL(t time.Time) string {
	day := fmt.Sprintf("%02d", t.Day())
	mon := t.Format("Jan")
	year := t.Year()

	file := fmt.Sprintf("%s_%s_%d_APT_CSV.zip", day, mon, year)
	return "https://nfdc.faa.gov/webContent/28DaySub/extra/" + file
}

//
// -----------------------------------------------------------------------------
// DOWNLOAD + ZIP VALIDATION
// -----------------------------------------------------------------------------

func download(url, path string) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, url)
	}

	out, err := os.Create(path)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

func isZipValid(path string) bool {
	r, err := zip.OpenReader(path)
	if err != nil {
		return false
	}
	r.Close()
	return true
}

//
// -----------------------------------------------------------------------------
// PIPELINE
// -----------------------------------------------------------------------------

func runPipeline(zipPath string) {
	csvPath, err := extractCSV(zipPath)
	if err != nil {
		panic(err)
	}
	defer os.Remove(csvPath)

	fmt.Println("[INFO] Parsing CSV:", csvPath)

	airports, err := parseAirports(csvPath)
	if err != nil {
		panic(err)
	}

	os.MkdirAll("public", 0755)

	err = writeJSON("public/airports.json", airports)
	if err != nil {
		panic(err)
	}

	fmt.Println("[INFO] NASR update completed successfully.")
}

//
// -----------------------------------------------------------------------------
// ZIP EXTRACTION
// -----------------------------------------------------------------------------

func extractCSV(zipPath string) (string, error) {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return "", err
	}
	defer r.Close()

	for _, f := range r.File {
		if strings.EqualFold(f.Name, "APT_BASE.csv") {
			rc, err := f.Open()
			if err != nil {
				return "", err
			}
			defer rc.Close()

			outName := "APT_BASE.csv"
			out, err := os.Create(outName)
			if err != nil {
				return "", err
			}
			defer out.Close()

			_, err = io.Copy(out, rc)
			return outName, err
		}
	}

	return "", fmt.Errorf("APT_BASE.csv not found in ZIP")
}

//
// -----------------------------------------------------------------------------
// CSV PARSER
// -----------------------------------------------------------------------------

func parseAirports(path string) ([]Airport, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1

	rows, err := r.ReadAll()
	if err != nil {
		return nil, err
	}

	header := rows[0]
	col := func(name string) int {
		for i, h := range header {
			if h == name {
				return i
			}
		}
		return -1
	}

	iID := col("ARPT_ID")
	iLat := col("LAT_DECIMAL")
	iLon := col("LONG_DECIMAL")
	iName := col("ARPT_NAME")
	iCity := col("CITY")
	iState := col("STATE_CODE")
	iFuel := col("FUEL_TYPES")

	var out []Airport

	for _, row := range rows[1:] {
		lat, _ := strconv.ParseFloat(row[iLat], 64)
		lon, _ := strconv.ParseFloat(row[iLon], 64)
		id := strings.TrimSpace(row[iID])

		ap := Airport{
			ArptID: id,
			Name:   row[iName],
			City:   row[iCity],
			State:  row[iState],
			ICAO:   "K" + id,
			Lat:    lat,
			Lon:    lon,
			Fuel:   parseFuel(row[iFuel]),
		}

		out = append(out, ap)
	}

	return out, nil
}

func parseFuel(s string) map[string]bool {
	x := strings.ToUpper(s)
	return map[string]bool{
		"mogas": strings.Contains(x, "MOGAS"),
		"100ll": strings.Contains(x, "100"),
		"jet_a": strings.Contains(x, "JET"),
	}
}

//
// -----------------------------------------------------------------------------
// JSON OUTPUT
// -----------------------------------------------------------------------------

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0644)
}
