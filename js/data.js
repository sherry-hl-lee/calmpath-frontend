/* CalmPath — Melbourne CBD mock data (Open Data–style demo) */

const DEFAULT_ORIGIN = {
  name: "Your location",
  lat: -37.8183,
  lng: 144.9671,
};

/** Mutable start point — defaults to user location or Flinders fallback */
const ORIGIN = {
  name: DEFAULT_ORIGIN.name,
  lat: DEFAULT_ORIGIN.lat,
  lng: DEFAULT_ORIGIN.lng,
  source: "default",
};

function setOrigin(next) {
  if (!next || !Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return ORIGIN;
  ORIGIN.name = next.name || "Custom start";
  ORIGIN.lat = next.lat;
  ORIGIN.lng = next.lng;
  ORIGIN.source = next.source || "custom";
  return ORIGIN;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const CBD_DESTINATIONS = [
  {
    id: "flinders",
    name: "Flinders Street Station",
    aliases: ["flinders", "flinders street", "flinders st"],
    lat: -37.8183,
    lng: 144.9671,
  },
  {
    id: "state-library",
    name: "State Library Victoria",
    aliases: ["state library", "library", "slv"],
    lat: -37.8098,
    lng: 144.9652,
  },
  {
    id: "flagstaff",
    name: "Flagstaff Gardens",
    aliases: ["flagstaff", "gardens"],
    lat: -37.8105,
    lng: 144.9542,
  },
  {
    id: "federation",
    name: "Federation Square",
    aliases: ["federation", "fed square", "fedsquare"],
    lat: -37.8182,
    lng: 144.9691,
  },
  {
    id: "queen-vic",
    name: "Queen Victoria Market",
    aliases: ["queen victoria", "qvm", "market"],
    lat: -37.8076,
    lng: 144.9568,
  },
  {
    id: "rmit",
    name: "RMIT University",
    aliases: ["rmit", "university"],
    lat: -37.808,
    lng: 144.963,
  },
];

const LEVEL = { low: 0, medium: 1, high: 2, limited: 1 };

/* Approximate corridor longitudes — used as OSRM via-points to prefer quieter/busier streets */
const STREET = {
  swanston: 144.9638,
  elizabeth: 144.9618,
  russell: 144.9678,
};

const OSRM_WALKING = "https://router.project-osrm.org/route/v1/walking";

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatDuration(seconds) {
  const mins = Math.max(1, Math.round(seconds / 60));
  return `${mins} min`;
}

/**
 * Ask OSRM for a walking route that follows the real road/footpath network.
 * points: [{lat,lng}, ...]  (OSRM uses lon,lat in the URL)
 */
async function fetchOsrmWalkingPath(points) {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${OSRM_WALKING}/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.[0]?.geometry?.coordinates?.length) {
    throw new Error(data.message || "OSRM returned no route");
  }
  const route = data.routes[0];
  return {
    path: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceM: route.distance,
    durationS: route.duration,
  };
}

/** Fallback only if OSRM is offline — still axis-aligned, not true roads */
function buildStreetPathFallback(corridorLng, dest) {
  const startLat = ORIGIN.lat;
  const startLng = ORIGIN.lng;
  const path = [[startLat, startLng]];
  if (Math.abs(startLng - corridorLng) > 0.00012) path.push([startLat, corridorLng]);
  path.push([dest.lat, corridorLng]);
  if (Math.abs(corridorLng - dest.lng) > 0.00012) path.push([dest.lat, dest.lng]);
  return path;
}

const ROUTES_TEMPLATE = [
  {
    id: "a",
    name: "Route A",
    sensory: "Low",
    sensoryClass: "low",
    level: LEVEL.low,
    crowdScore: 32,
    note: "Less crowded · Prefer Elizabeth St",
    recommended: true,
    limitedData: false,
    viaLng: STREET.elizabeth,
    forceVia: true,
  },
  {
    id: "b",
    name: "Route B",
    sensory: "High",
    sensoryClass: "high",
    level: LEVEL.high,
    crowdScore: 88,
    note: "Shortest path · Likely busier streets",
    recommended: false,
    limitedData: false,
    viaLng: STREET.swanston,
    forceVia: false,
  },
  {
    id: "c",
    name: "Route C",
    sensory: "Limited Data",
    sensoryClass: "limited",
    level: LEVEL.medium,
    crowdScore: 55,
    note: "Partial sensor coverage · Via Russell St",
    recommended: false,
    limitedData: true,
    viaLng: STREET.russell,
    forceVia: true,
  },
];

/**
 * Build road-snapped walking routes for A/B/C using OSRM.
 * A & C bias via quieter/alternate corridors; B is shortest walking path.
 */
async function buildRoadRoutesForDestination(dest) {
  const origin = { lat: ORIGIN.lat, lng: ORIGIN.lng };
  const target = { lat: dest.lat, lng: dest.lng };

  const built = await Promise.all(
    ROUTES_TEMPLATE.map(async (template) => {
      const midLat = (origin.lat + target.lat) / 2;
      const via = { lat: midLat, lng: template.viaLng };
      const points = template.forceVia
        ? [origin, via, target]
        : [origin, target];

      try {
        const routed = await fetchOsrmWalkingPath(points);
        return {
          ...template,
          path: routed.path,
          distance: formatDistance(routed.distanceM),
          time: formatDuration(routed.durationS),
          distanceM: routed.distanceM,
          roadSnapped: true,
        };
      } catch (err) {
        console.warn("OSRM unavailable, using fallback path", err);
        const path = buildStreetPathFallback(template.viaLng, target);
        return {
          ...template,
          path,
          time: template.id === "b" ? "15 min" : template.id === "a" ? "18 min" : "17 min",
          distance: template.id === "b" ? "1.0 km" : template.id === "a" ? "1.2 km" : "1.4 km",
          roadSnapped: false,
        };
      }
    })
  );

  return built;
}

function cloneRoutesForDestination(dest) {
  // Sync fallback for older call sites; prefer buildRoadRoutesForDestination
  return ROUTES_TEMPLATE.map((r) => ({
    ...r,
    path: buildStreetPathFallback(r.viaLng, dest || CBD_DESTINATIONS[0]),
    time: r.id === "b" ? "15 min" : r.id === "a" ? "18 min" : "17 min",
    distance: r.id === "b" ? "1.0 km" : r.id === "a" ? "1.2 km" : "1.4 km",
    roadSnapped: false,
  }));
}

function cloneRoutes() {
  return cloneRoutesForDestination(CBD_DESTINATIONS[0]);
}

const BUSY_ZONES = [
  {
    id: "swanston-peak",
    name: "Busy Area",
    label: "Peak Crowd",
    lat: -37.8142,
    lng: 144.9638,
    radius: 120,
  },
  {
    id: "flinders-corridor",
    name: "Busy Area",
    label: "Busy Area",
    lat: -37.8165,
    lng: 144.9658,
    radius: 90,
  },
];

const PT_STOPS = [
  { id: "tram-flinders", type: "Tram", icon: "🚋", lat: -37.8178, lng: 144.9662 },
  { id: "train-flinders", type: "Train", icon: "🚆", lat: -37.8183, lng: 144.9671 },
  { id: "bus-lonsdale", type: "Bus", icon: "🚌", lat: -37.8125, lng: 144.962 },
  { id: "tram-swanston", type: "Tram", icon: "🚋", lat: -37.8135, lng: 144.9635 },
];

/** US2.1 nearby shape: no address. Types only park | library (from sub_theme). */
const REFUGE_CATALOG = [
  {
    id: "ea40efc1f181c0943d97b001",
    name: "Flagstaff Gardens",
    type: "park",
    latitude: -37.8105,
    longitude: 144.9542,
  },
  {
    id: "ea40efc1f181c0943d97b002",
    name: "State Library Victoria",
    type: "library",
    latitude: -37.8098,
    longitude: 144.9652,
  },
  {
    id: "ea40efc1f181c0943d97b003",
    name: "Treasury Gardens",
    type: "park",
    latitude: -37.8142,
    longitude: 144.9755,
  },
];

/** Mock nearest street matches for GET /api/v1/refuges/address (keyed by refuge id). */
const REFUGE_ADDRESS_MOCK = {
  ea40efc1f181c0943d97b001: {
    address: "309 William Street West Melbourne",
    latitude: -37.81048,
    longitude: 144.95415,
    match_distance_m: 28.4,
    source: "City of Melbourne Street Addresses",
  },
  ea40efc1f181c0943d97b002: {
    address: "328 Swanston Street Melbourne",
    latitude: -37.80982,
    longitude: 144.96525,
    match_distance_m: 12.1,
    source: "City of Melbourne Street Addresses",
  },
  // Treasury Gardens: no street address within 200 m (demo 404)
};

/** Kept for compatibility; distances are computed from current ORIGIN */
const refuges = REFUGE_CATALOG;

function createApiError(status, detail, retryAfter) {
  const err = new Error(detail || `HTTP ${status}`);
  err.status = status;
  err.detail = detail;
  if (retryAfter != null) err.retryAfter = retryAfter;
  return err;
}

function validateRefugeCoords(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

/** Mock of GET /api/v1/refuges/nearby — bare array, no address field */
function fetchNearbyRefugesMock(latitude, longitude, radius_m) {
  const coords = validateRefugeCoords(latitude, longitude);
  const radius = Number(radius_m);

  if (!coords || !Number.isFinite(radius) || radius <= 0) {
    return Promise.reject(createApiError(422, "Invalid latitude, longitude, or radius_m"));
  }

  const results = REFUGE_CATALOG.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    latitude: r.latitude,
    longitude: r.longitude,
    distance_m: Math.round(haversineMeters(coords.lat, coords.lng, r.latitude, r.longitude) * 100) / 100,
  }))
    .filter((r) => r.distance_m <= radius)
    .sort((a, b) => a.distance_m - b.distance_m);

  return Promise.resolve(results);
}

/**
 * Mock of GET /api/v1/refuges/address — call only after the user selects a refuge.
 * Fixed backend match radius is 200 m; this mock does not accept a custom radius.
 */
function fetchRefugeAddressMock(latitude, longitude) {
  const coords = validateRefugeCoords(latitude, longitude);
  if (!coords) {
    return Promise.reject(createApiError(422, "Invalid latitude or longitude"));
  }

  const match = REFUGE_CATALOG.find(
    (r) => haversineMeters(coords.lat, coords.lng, r.latitude, r.longitude) < 5
  );
  const payload = match ? REFUGE_ADDRESS_MOCK[match.id] : null;

  if (!payload) {
    return Promise.reject(
      createApiError(404, "No valid street address within 200 m of this location")
    );
  }

  return Promise.resolve({ ...payload });
}

function refugeTypeLabel(type) {
  if (!type) return "";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function refugeIcon(type) {
  if (type === "park") return "🌳";
  if (type === "library") return "📚";
  return "📍";
}

function formatRefugeAddressLine(status) {
  if (!status) return "";
  if (status.state === "loading") return "Looking up nearby street address…";
  if (status.state === "ok" && status.data) return status.data.address;
  if (status.state === "error") {
    if (status.status === 404) return "No street address within 200 m (refuge still valid)";
    if (status.status === 429) return "Address lookup limited — try again shortly";
    if (status.status === 503) return "Address service temporarily unavailable";
    return status.message || "Could not load address";
  }
  return "";
}

function matchPlace(query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return null;

  const coord = q.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
  if (coord) {
    const lat = Number(coord[1]);
    const lng = Number(coord[3]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return {
        id: "coords",
        name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        lat,
        lng,
      };
    }
  }

  return (
    CBD_DESTINATIONS.find(
      (d) =>
        d.name.toLowerCase() === q ||
        d.aliases.some((a) => q.includes(a) || a.includes(q))
    ) || null
  );
}

const predictiveAlerts = [
  {
    id: "atrium",
    location: "Central Atrium",
    timeframe: "Next Hour",
    crowdLevel: "High",
    crowdClass: "high",
    message: "No need to rush. You have plenty of time to take a quieter path.",
    basedOn: "Historical Trend",
  },
  {
    id: "swanston",
    location: "Swanston Street corridor",
    timeframe: "Next Hour",
    crowdLevel: "High",
    crowdClass: "high",
    message: "Pedestrian volume typically rises sharply after 5pm on weekdays.",
    basedOn: "Historical Trend",
  },
  {
    id: "market",
    location: "Queen Victoria Market precinct",
    timeframe: "Next 2 Hours",
    crowdLevel: "Medium",
    crowdClass: "medium",
    message: "Moderate crowds expected near market exits.",
    basedOn: "Historical Trend",
  },
];

function matchDestination(query) {
  return matchPlace(query);
}

function isMelbourneCbdQuery(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return false;
  if (matchDestination(q)) return true;
  return (
    q.includes("melbourne") ||
    q.includes("cbd") ||
    q.includes("swanston") ||
    q.includes("collins") ||
    q.includes("bourke")
  );
}
