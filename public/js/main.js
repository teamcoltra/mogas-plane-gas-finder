/**
 * public/js/main.js
 *
 * Adds an IntersectionObserver to auto-load more results when the
 * "Load More" button scrolls into view. Disables/hides the button when
 * there are no more results. Tracks loading state to avoid double-loads.
 *
 * Integrates with the existing UI classes used in index.html.
 */

let airports = [];
let filtered = [];
let markers = [];
let map;
let center = { lat: 39.5, lon: -98.3 };
let radiusMiles = 200;
let radiusCircle = null;
let centerMarker = null;

const MAX_PINS = 2000;
const PAGE_SIZE = 80;

let listPage = 0;
let searchMode = "view"; // "view", "radius", or "all"

// Load-more state
let isLoadingMore = false;
let loadMoreObserver = null;

async function init() {
  // Map Setup
  map = L.map("map", { minZoom: 4, maxZoom: 12 }).setView(
    [center.lat, center.lon],
    6,
  );

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
  }).addTo(map);

  map.on("click", (e) => {
    center = { lat: e.latlng.lat, lon: e.latlng.lng };
    if (searchMode === "view") {
      searchMode = "radius";
      updateModeButtons();
      zoomToRadius();
    }
    render();
  });

  map.on("moveend zoomend", () => {
    if (searchMode === "view") render();
  });

  // Try to get current position if available
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      center = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      map.setView([center.lat, center.lon], 7);
      render();
    },
    () => {},
  );

  // Load Data
  airports = await (await fetch("airports.json")).json();

  initUI();
  render();
}

function initUI() {
  // Fuel buttons: ensure ARIA is set and toggle active class + aria-pressed
  ["mogas", "100ll", "jet"].forEach((id) => {
    const el = document.getElementById(`fuel-${id}`);
    if (!el) return;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    if (!el.hasAttribute("aria-pressed"))
      el.setAttribute("aria-pressed", "false");

    const toggleHandler = () => {
      const isActive = el.classList.toggle("active");
      el.setAttribute("aria-pressed", isActive ? "true" : "false");
      // When filters change, reset list page so list reflects new filter
      listPage = 0;
      render();
    };

    el.addEventListener("click", toggleHandler);
    // support keyboard toggle (space/enter)
    el.addEventListener("keydown", (ev) => {
      if (ev.key === " " || ev.key === "Enter") {
        ev.preventDefault();
        toggleHandler();
      }
    });
  });

  // Slider
  const slider = document.getElementById("radius-slider");
  if (slider) {
    slider.addEventListener("input", (e) => {
      radiusMiles = Number(e.target.value);
      document.getElementById("radius-display").textContent =
        `${radiusMiles} miles`;

      if (searchMode === "radius") {
        zoomToRadius();
      }
      // radius change updates results
      listPage = 0;
      render();
    });
  }

  // Show circle checkbox
  const showCircleEl = document.getElementById("showCircle");
  if (showCircleEl)
    showCircleEl.addEventListener("change", () => {
      // changing checkbox doesn't change selection, but may show/hide circle
      render();
    });

  // Mode buttons
  const viewBtn = document.getElementById("viewModeBtn");
  const listBtn = document.getElementById("listAllBtn");

  if (viewBtn) {
    viewBtn.addEventListener("click", () => {
      searchMode = "view";
      updateModeButtons();
      listPage = 0;
      render();
    });
  }

  if (listBtn) {
    listBtn.addEventListener("click", () => {
      searchMode = "all";
      updateModeButtons();
      listPage = 0;
      render();
    });
  }

  // Load More button click (manual)
  const loadMore = document.getElementById("loadMoreBtn");
  if (loadMore) {
    loadMore.addEventListener("click", () => {
      // Manual click should load next page if available
      attemptLoadMore();
    });
  }

  // Setup IntersectionObserver for auto load more on scroll into view
  setupLoadMoreObserver();

  initMapExpand();
  updateModeButtons();
}

/**
 * Attempt to load more results (debounced by isLoadingMore).
 * Called by button click or intersection observer.
 */
function attemptLoadMore() {
  if (isLoadingMore) return;
  const hasMore = (listPage + 1) * PAGE_SIZE < filtered.length;
  if (!hasMore) {
    updateLoadMoreState(); // make sure UI reflects no more
    return;
  }
  isLoadingMore = true;
  // Use requestAnimationFrame to ensure UI can update
  requestAnimationFrame(() => {
    listPage++;
    renderList(false);
    isLoadingMore = false;
    updateLoadMoreState();
  });
}

function updateModeButtons() {
  const viewBtn = document.getElementById("viewModeBtn");
  const allBtn = document.getElementById("listAllBtn");
  if (!viewBtn || !allBtn) return;

  if (searchMode === "view" || searchMode === "radius") {
    viewBtn.className =
      "py-3 rounded-xl btn-primary shadow-lg hover:shadow-xl transition-all";
    allBtn.className =
      "py-3 rounded-xl btn-neutral hover:bg-gray-300 transition-all";
  } else {
    viewBtn.className =
      "py-3 rounded-xl btn-neutral hover:bg-gray-300 transition-all";
    allBtn.className =
      "py-3 rounded-xl btn-primary shadow-lg hover:shadow-xl transition-all";
  }
}

function zoomToRadius() {
  const metersPerMile = 1609.34;
  const radiusMeters = radiusMiles * metersPerMile;
  const bounds = L.latLng(center.lat, center.lon).toBounds(radiusMeters * 2);
  map.fitBounds(bounds, { padding: [50, 50] });
}

function initMapExpand() {
  const btn = document.getElementById("expandMap");
  const mapDiv = document.getElementById("map");
  if (!btn || !mapDiv) return;
  let expanded = false;

  btn.addEventListener("click", () => {
    expanded = !expanded;
    mapDiv.classList.toggle("h-[350px]");
    mapDiv.classList.toggle("h-[700px]");
    btn.textContent = expanded ? "Shrink Map" : "Expand Map";
    setTimeout(() => map.invalidateSize(), 300);
  });
}

// ------------------------ FILTERING ------------------------

function getSelectedFuels() {
  const res = [];
  if (document.getElementById("fuel-mogas")?.classList.contains("active"))
    res.push("mogas");
  if (document.getElementById("fuel-100ll")?.classList.contains("active"))
    res.push("100ll");
  if (document.getElementById("fuel-jet")?.classList.contains("active"))
    res.push("jet_a");
  return res;
}

function haversine(a, b) {
  const R = 3958.8; // miles
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

function inBounds(ap) {
  return map.getBounds().contains([ap.lat, ap.lon]);
}

function filterAirports() {
  const fuels = getSelectedFuels();
  if (fuels.length === 0) return [];

  let result = airports.filter((ap) => fuels.some((f) => ap.fuel[f]));

  if (searchMode === "all") {
    return result;
  } else if (searchMode === "radius") {
    return result.filter((ap) => haversine(center, ap) <= radiusMiles);
  } else {
    return result.filter((ap) => inBounds(ap));
  }
}

// ------------------------ RENDER ------------------------

function render() {
  filtered = filterAirports();

  // Sort by distance for predictable ordering
  filtered = filtered
    .map((ap) => ({ ...ap, dist: haversine(center, ap) }))
    .sort((a, b) => a.dist - b.dist);

  // Limit pins to MAX_PINS
  const pinsToShow = filtered.slice(0, MAX_PINS);

  renderPins(pinsToShow);
  renderRadiusCircle();

  // When filters change, render list from first page
  renderList(true);
  // update load-more state based on new filtered set
  updateLoadMoreState();
}

function renderRadiusCircle() {
  // Remove existing circle and marker
  if (radiusCircle) {
    map.removeLayer(radiusCircle);
    radiusCircle = null;
  }
  if (centerMarker) {
    map.removeLayer(centerMarker);
    centerMarker = null;
  }

  const showCircle = document.getElementById("showCircle")?.checked;

  if (searchMode === "radius" || (searchMode !== "all" && showCircle)) {
    radiusCircle = L.circle([center.lat, center.lon], {
      radius: radiusMiles * 1609.34,
      color: "#2e7555",
      fillColor: "#95d765",
      fillOpacity: 0.08,
      weight: 2,
    }).addTo(map);

    centerMarker = L.marker([center.lat, center.lon], {
      icon: L.icon({
        iconUrl:
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='%232e7555'%3E%3Ccircle cx='12' cy='12' r='8'/%3E%3C/svg%3E",
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    }).addTo(map);

    centerMarker.bindPopup(
      `<b>Search Center</b><br>${radiusMiles} mile radius`,
    );
  }
}

function renderPins(airportsToShow) {
  markers.forEach((m) => map.removeLayer(m));
  markers = [];

  airportsToShow.forEach((ap) => {
    const m = L.marker([ap.lat, ap.lon]).addTo(map);
    markers.push(m);

    const fuelsText = Object.keys(ap.fuel)
      .filter((f) => ap.fuel[f])
      .join(", ");

    m.bindPopup(
      `<b>${escapeHtml(ap.name)}</b><br>` +
        `${escapeHtml(ap.city)}, ${escapeHtml(ap.state)}<br>` +
        `Fuel: ${escapeHtml(fuelsText)}<br>` +
        `Distance: ${ap.dist.toFixed(1)} mi<br>` +
        `<a href="https://www.airnav.com/airport/K${ap.arpt_id}" target="_blank" style="color:#2e7555; text-decoration:underline;">View on AirNav</a>`,
    );
  });
}

/**
 * Renders the list.
 * If reset === true, clears list and renders first page.
 * If reset === false, appends the next page (based on listPage).
 */
function renderList(reset) {
  const list = document.getElementById("list");
  const count = document.getElementById("resultCount");
  if (!list || !count) return;

  if (reset) {
    list.innerHTML = "";
    listPage = 0;
  }

  const start = listPage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, filtered.length);

  const chunk = filtered.slice(start, end);

  chunk.forEach((ap) => {
    const div = document.createElement("div");
    // hover:bg-green-50 assumes tailwind/custom class exists; keeps green accent
    div.className = "p-4 border rounded-xl hover:bg-green-50 transition";

    const fuels = Object.keys(ap.fuel)
      .filter((k) => ap.fuel[k])
      .join(", ");

    div.innerHTML = `
      <div class="font-semibold text-gray-800">
        ${escapeHtml(ap.name)} <span class="text-gray-500 text-sm">(${escapeHtml(ap.arpt_id)})</span>
      </div>
      <div class="text-gray-600">${escapeHtml(ap.city)}, ${escapeHtml(ap.state)}</div>
      <div class="text-gray-700 text-sm">Fuel: ${escapeHtml(fuels)}</div>
      <div class="text-gray-600 text-sm">Distance: ${ap.dist.toFixed(1)} miles</div>
      <a class="text-primary text-sm underline" target="_blank" href="https://www.airnav.com/airport/K${ap.arpt_id}">
        View on AirNav
      </a>
    `;

    list.appendChild(div);
  });

  const modeText =
    searchMode === "all"
      ? "total"
      : searchMode === "radius"
        ? `within ${radiusMiles}mi`
        : "in view";

  count.textContent = `(${filtered.length} ${modeText}${filtered.length > MAX_PINS ? `, ${MAX_PINS} shown on map` : ""})`;

  // After rendering, update the load-more button/observer state
  updateLoadMoreState();
}

/**
 * Initializes IntersectionObserver and related logic to auto-load more.
 */
function setupLoadMoreObserver() {
  const loadMoreBtn = document.getElementById("loadMoreBtn");
  if (!loadMoreBtn || typeof IntersectionObserver === "undefined") {
    // If no button or IntersectionObserver not available, nothing to do
    return;
  }

  // Clean up previous observer if any
  if (loadMoreObserver) {
    loadMoreObserver.disconnect();
    loadMoreObserver = null;
  }

  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          // Button has scrolled into view
          // Only trigger load more when not currently loading and when more items exist
          if (!isLoadingMore) {
            const hasMore = (listPage + 1) * PAGE_SIZE < filtered.length;
            if (hasMore) {
              attemptLoadMore();
            } else {
              // No more items; ensure UI reflects that (do not unobserve yet, updateLoadMoreState will)
              updateLoadMoreState();
            }
          }
        }
      }
    },
    {
      root: null,
      rootMargin: "0px",
      threshold: 0.5, // at least 50% visible
    },
  );

  loadMoreObserver.observe(loadMoreBtn);
}

/**
 * Enable/disable/hide the Load More button and manage observer lifecycle
 * depending on whether there are more items.
 */
function updateLoadMoreState() {
  const loadMoreBtn = document.getElementById("loadMoreBtn");
  if (!loadMoreBtn) return;

  const totalShown = (listPage + 1) * PAGE_SIZE;
  const hasMore = totalShown < filtered.length;

  if (!hasMore) {
    // No more items: disable the button and unobserve
    loadMoreBtn.classList.add("opacity-50");
    loadMoreBtn.setAttribute("disabled", "true");
    if (loadMoreObserver) {
      loadMoreObserver.unobserve(loadMoreBtn);
    }
  } else {
    // There are more items: enable the button and ensure observer is observing
    loadMoreBtn.classList.remove("opacity-50");
    loadMoreBtn.removeAttribute("disabled");

    // If observer was not created yet (e.g., created before DOM existed), create it
    if (!loadMoreObserver && typeof IntersectionObserver !== "undefined") {
      setupLoadMoreObserver();
    } else if (loadMoreObserver) {
      // Ensure we're observing it
      try {
        loadMoreObserver.observe(loadMoreBtn);
      } catch (err) {
        // ignore if already observing
      }
    }
  }
}

/* Utility: simple html escape for injected strings */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

init();
