/* CalmPath — backend API client (CloudFront → ECS FastAPI)
 *
 * Refuge (US2.1): GET /api/v1/refuges/nearby, GET /api/v1/refuges/address
 * Routes (US1.1): GET /api/v1/routes — sensory + nearby tram/train
 * Routes (US1.2): POST /api/v1/routes/compare — shortest vs lower-crowd
 * Open-data / OSRM fallbacks remain for local dev when API_BASE is cleared.
 */

const API_BASE = "https://dpevp4238kw5k.cloudfront.net";

const COM_PORTAL = "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets";
const LANDMARKS_DATASET =
  "landmarks-and-places-of-interest-including-schools-theatres-health-services-spor";
const STREET_ADDRESSES_DATASET = "street-addresses";
const ADDRESS_MATCH_M = 200;

const REFUGE_SUB_THEME_TO_TYPE = {
  "Informal Outdoor Facility (Park/Garden/Reserve)": "park",
  Library: "library",
};

let refugeCatalogPromise = null;

async function readApiErrorDetail(res) {
  const text = await res.text();
  if (!text) return res.statusText || `HTTP ${res.status}`;
  try {
    const body = JSON.parse(text);
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      return body.detail
        .map((item) => (typeof item === "string" ? item : item.msg || JSON.stringify(item)))
        .join("; ");
    }
  } catch (_) {
    /* plain text error body */
  }
  return text;
}

function slugId(name, lat, lng) {
  const slug = String(name || "place")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${slug}-${Number(lat).toFixed(5)}-${Number(lng).toFixed(5)}`;
}

function mapLandmarkRecord(row) {
  const type = REFUGE_SUB_THEME_TO_TYPE[row.sub_theme];
  if (!type) return null;
  const lat = row.co_ordinates && Number(row.co_ordinates.lat);
  const lng = row.co_ordinates && Number(row.co_ordinates.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = row.feature_name || "Quiet space";
  return {
    id: slugId(name, lat, lng),
    name,
    type,
    latitude: lat,
    longitude: lng,
  };
}

async function fetchComRecords(datasetId, params) {
  const url = new URL(`${COM_PORTAL}/${datasetId}/records`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") url.searchParams.set(key, value);
  });

  const res = await fetch(url.toString());
  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    throw createApiError(429, "Rate limited by City of Melbourne open data", retryAfter);
  }
  if (!res.ok) {
    throw createApiError(
      res.status >= 500 ? 503 : res.status,
      `Open data request failed (${res.status})`
    );
  }
  const body = await res.json();
  return Array.isArray(body.results) ? body.results : [];
}

/** Load + cache all primary refuge candidates from CoM landmarks. */
function loadRefugeCatalogFromOpenData() {
  if (refugeCatalogPromise) return refugeCatalogPromise;

  const where =
    'sub_theme="Informal Outdoor Facility (Park/Garden/Reserve)" OR sub_theme="Library"';

  refugeCatalogPromise = fetchComRecords(LANDMARKS_DATASET, {
    where,
    limit: 100,
  })
    .then((rows) => rows.map(mapLandmarkRecord).filter(Boolean))
    .catch((err) => {
      refugeCatalogPromise = null;
      throw err;
    });

  return refugeCatalogPromise;
}

async function fetchNearbyRefugesLive(latitude, longitude, radius_m) {
  const coords = validateRefugeCoords(latitude, longitude);
  const radius = Number(radius_m);
  if (!coords || !Number.isFinite(radius) || radius <= 0) {
    throw createApiError(422, "Invalid latitude, longitude, or radius_m");
  }

  const catalog = await loadRefugeCatalogFromOpenData();
  return catalog
    .map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      latitude: r.latitude,
      longitude: r.longitude,
      distance_m:
        Math.round(haversineMeters(coords.lat, coords.lng, r.latitude, r.longitude) * 100) / 100,
    }))
    .filter((r) => r.distance_m <= radius)
    .sort((a, b) => a.distance_m - b.distance_m);
}

function formatStreetAddress(row) {
  if (!row) return "";
  if (row.address_pnt) return String(row.address_pnt).trim();
  if (row.add_comp) return String(row.add_comp).trim();
  const parts = [row.street_no, row.str_name, row.suburb].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function fetchRefugeAddressLive(latitude, longitude) {
  const coords = validateRefugeCoords(latitude, longitude);
  if (!coords) {
    throw createApiError(422, "Invalid latitude or longitude");
  }

  // Same fixed 200 m match as US2.1 backend (POINT lon lat)
  const where = `within_distance(geo_point_2d, geom'POINT(${coords.lng} ${coords.lat})', ${ADDRESS_MATCH_M}m)`;
  const orderBy = `distance(geo_point_2d, geom'POINT(${coords.lng} ${coords.lat})')`;

  let rows;
  try {
    rows = await fetchComRecords(STREET_ADDRESSES_DATASET, {
      where,
      order_by: orderBy,
      limit: 1,
    });
  } catch (err) {
    if (err.status === 429) throw err;
    throw createApiError(503, err.detail || err.message || "Address lookup unavailable");
  }

  const row = rows[0];
  const address = formatStreetAddress(row);
  if (!row || !address) {
    throw createApiError(404, "No valid street address within 200 m of this location");
  }

  const matchLat = Number(row.latitude);
  const matchLng = Number(row.longitude);
  const matchDistance = Number.isFinite(matchLat) && Number.isFinite(matchLng)
    ? Math.round(haversineMeters(coords.lat, coords.lng, matchLat, matchLng) * 10) / 10
    : null;

  return {
    address,
    latitude: Number.isFinite(matchLat) ? matchLat : coords.lat,
    longitude: Number.isFinite(matchLng) ? matchLng : coords.lng,
    match_distance_m: matchDistance,
    source: "City of Melbourne Street Addresses",
  };
}

async function fetchNearbyRefugesFromBackend(latitude, longitude, radius_m) {
  const url = new URL(`${API_BASE}/api/v1/refuges/nearby`);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("radius_m", String(radius_m));
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw createApiError(res.status, await readApiErrorDetail(res));
  }
  return res.json();
}

async function fetchRefugeAddressFromBackend(latitude, longitude) {
  const url = new URL(`${API_BASE}/api/v1/refuges/address`);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  const res = await fetch(url.toString());
  if (res.status === 404) {
    throw createApiError(
      404,
      (await readApiErrorDetail(res)) ||
        "No valid street address within 200 m of this location"
    );
  }
  if (!res.ok) {
    const retryAfter = res.headers.get("Retry-After");
    throw createApiError(res.status, await readApiErrorDetail(res), retryAfter);
  }
  return res.json();
}

/** Public nearby API used by the UI (backend → open data → mock). */
async function fetchNearbyRefuges(latitude, longitude, radius_m) {
  if (API_BASE) {
    return fetchNearbyRefugesFromBackend(latitude, longitude, radius_m);
  }
  try {
    return await fetchNearbyRefugesLive(latitude, longitude, radius_m);
  } catch (err) {
    console.warn("Open data nearby failed; using mock catalog.", err);
    return fetchNearbyRefugesMock(latitude, longitude, radius_m);
  }
}

/** Public address API used by the UI (backend → open data → mock). */
async function fetchRefugeAddress(latitude, longitude) {
  if (API_BASE) {
    return fetchRefugeAddressFromBackend(latitude, longitude);
  }
  try {
    return await fetchRefugeAddressLive(latitude, longitude);
  } catch (err) {
    if (err.status === 404 || err.status === 429) throw err;
    console.warn("Open data address failed; using mock.", err);
    return fetchRefugeAddressMock(latitude, longitude);
  }
}

function geoJsonToLeafletPath(geometry) {
  if (!geometry || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return [];
  }
  return geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

function crowdLevelToUi(crowdLevel, limitedData) {
  if (limitedData || crowdLevel == null) {
    return { level: LEVEL.limited, sensoryClass: "limited", limitedData: true };
  }
  const key = String(crowdLevel).toUpperCase();
  if (key === "LOW") return { level: LEVEL.low, sensoryClass: "low", limitedData: false };
  if (key === "MEDIUM") return { level: LEVEL.medium, sensoryClass: "medium", limitedData: false };
  if (key === "HIGH") return { level: LEVEL.high, sensoryClass: "high", limitedData: false };
  return { level: LEVEL.limited, sensoryClass: "limited", limitedData: true };
}

/** Map US1.1 sensory_indicator (Low / High / Limited Data / …) to UI badges. */
function sensoryIndicatorToUi(indicator) {
  const key = String(indicator || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (key === "low") return { level: LEVEL.low, sensoryClass: "low", limitedData: false };
  if (key === "medium") return { level: LEVEL.medium, sensoryClass: "medium", limitedData: false };
  if (key === "high") return { level: LEVEL.high, sensoryClass: "high", limitedData: false };
  if (key === "limited" || key === "limited_data" || key.includes("limited")) {
    return { level: LEVEL.limited, sensoryClass: "limited", limitedData: true };
  }
  return { level: LEVEL.limited, sensoryClass: "limited", limitedData: true };
}

function mapNearbyTransport(stops) {
  return (Array.isArray(stops) ? stops : [])
    .map((stop) => {
      const lat = Number(stop.latitude);
      const lng = Number(stop.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const type = String(stop.type || "tram").toLowerCase();
      const label = type === "train" ? "Train" : type === "bus" ? "Bus" : "Tram";
      const icon = type === "train" ? "🚆" : type === "bus" ? "🚌" : "🚋";
      return {
        id: stop.id || `${type}-${lat.toFixed(5)}-${lng.toFixed(5)}`,
        name: stop.name || `${label} stop`,
        type,
        label,
        icon,
        lat,
        lng,
        distance_to_route_m: Number.isFinite(Number(stop.distance_to_route_m))
          ? Number(stop.distance_to_route_m)
          : null,
      };
    })
    .filter(Boolean);
}

function buildRouteNote(apiRoute) {
  if (apiRoute.limited_data) return "Limited sensor coverage on this route";
  if (apiRoute.has_congestion_warning) return "High pedestrian congestion detected on part of this route";
  if (apiRoute.crowd_level && apiRoute.sensory_level) {
    return `${apiRoute.crowd_level} crowd · ${apiRoute.sensory_level} sensory`;
  }
  return apiRoute.route_type === "shortest" ? "Shortest walking path" : "Lower crowd exposure route";
}

function buildUs11RouteNote(apiRoute, ui) {
  if (ui.limitedData) return "Limited sensor coverage on this route";
  const coverage = Number(apiRoute.sensor_coverage);
  const sensors = Number(apiRoute.sensors_used);
  const bits = [];
  if (Number.isFinite(sensors) && sensors > 0) bits.push(`${sensors} sensors`);
  if (Number.isFinite(coverage)) bits.push(`${Math.round(coverage * 100)}% coverage`);
  if (bits.length) return `${String(apiRoute.sensory_indicator || "Low")} sensory · ${bits.join(" · ")}`;
  return `${String(apiRoute.sensory_indicator || "Low")} sensory load`;
}

function mapApiRoute(apiRoute, id, name, recommended) {
  const ui = crowdLevelToUi(apiRoute.crowd_level, apiRoute.limited_data);
  const geometry = apiRoute.geometry || null;
  return {
    id,
    name,
    ...ui,
    crowdScore: Number.isFinite(apiRoute.crowd_exposure) ? apiRoute.crowd_exposure : 999,
    path: geoJsonToLeafletPath(geometry),
    geometry,
    distance: formatDistance(apiRoute.distance_m),
    time: formatDuration(apiRoute.walk_time_seconds),
    distanceM: apiRoute.distance_m,
    roadSnapped: true,
    recommended: Boolean(recommended),
    note: buildRouteNote(apiRoute),
    routeType: apiRoute.route_type,
    nearbyTransport: [],
  };
}

/** Map GET /api/v1/routes (US1.1) response to UI route cards + PT stops. */
function mapUs11RoutesResponse(response) {
  const raw = Array.isArray(response?.routes) ? response.routes : [];
  const sorted = [...raw].sort((a, b) => {
    const da = Number(a.distance_m);
    const db = Number(b.distance_m);
    if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
    return 0;
  });

  let bestIdx = 0;
  let bestScore = Infinity;
  sorted.forEach((route, index) => {
    const ui = sensoryIndicatorToUi(route.sensory_indicator);
    const score = Number.isFinite(Number(route.sensory_score))
      ? Number(route.sensory_score)
      : ui.limitedData
        ? 500
        : ui.level * 100;
    if (score < bestScore) {
      bestScore = score;
      bestIdx = index;
    }
  });

  const routes = sorted.map((apiRoute, index) => {
    const ui = sensoryIndicatorToUi(apiRoute.sensory_indicator);
    const geometry = apiRoute.geometry || null;
    const durationS = Number(apiRoute.duration_s);
    const distanceM = Number(apiRoute.distance_m);
    const isShortest = index === 0;
    const isRecommended = index === bestIdx;
    let name = `Route ${index + 1}`;
    if (isShortest && isRecommended) name = "Shortest Route";
    else if (isShortest) name = "Shortest Route";
    else if (isRecommended) name = "Recommended Route";

    return {
      id: String(apiRoute.id || `route-${index + 1}`),
      name,
      ...ui,
      crowdScore: Number.isFinite(Number(apiRoute.sensory_score))
        ? Number(apiRoute.sensory_score)
        : ui.level * 100,
      path: geoJsonToLeafletPath(geometry),
      geometry,
      distance: Number.isFinite(distanceM) ? formatDistance(distanceM) : "—",
      time: Number.isFinite(durationS) ? formatDuration(durationS) : "—",
      distanceM: Number.isFinite(distanceM) ? distanceM : null,
      roadSnapped: true,
      recommended: isRecommended,
      note: buildUs11RouteNote(apiRoute, ui),
      routeType: isShortest ? "shortest" : "alternative",
      nearbyTransport: mapNearbyTransport(apiRoute.nearby_transport),
      sensoryIndicator: apiRoute.sensory_indicator,
      sensorCoverage: apiRoute.sensor_coverage,
      sensorsUsed: apiRoute.sensors_used,
    };
  });

  return {
    routes,
    meta: {
      source: "us11",
      recommendation_status: null,
      recommendation_note: null,
      warning: null,
      route_count: routes.length,
      compare: null,
    },
  };
}

function bannerForUs11(meta, routes) {
  const count = routes?.length || meta?.route_count || 0;
  const limited = (routes || []).filter((r) => r.limitedData).length;
  if (!count) {
    return { message: "No walking routes found for this trip", type: "warn" };
  }
  if (limited === count) {
    return {
      message: `Found ${count} walking routes · sensory data limited on these corridors`,
      type: "warn",
    };
  }
  return {
    message: `Found ${count} walking routes · live sensory indicators and nearby tram/train stops`,
    type: "success",
  };
}

/** Map POST /api/v1/routes/compare response to UI route cards. */
function mapRoutesCompareResponse(response) {
  const routes = [];
  const shortest = mapApiRoute(response.shortest_route, "shortest", "Shortest Route", false);

  if (response.recommended_route_is_distinct) {
    const recommended = mapApiRoute(
      response.recommended_route,
      "recommended",
      "Recommended Route",
      response.recommendation_status === "LOWER_CROWD"
    );
    routes.push(recommended, shortest);
  } else {
    shortest.recommended = response.recommendation_status === "SHORTEST_ALREADY_BEST";
    if (response.recommendation_status === "SHORTEST_ALREADY_BEST") {
      shortest.name = "Shortest Route (Best Available)";
    }
    routes.push(shortest);
  }

  return {
    routes,
    meta: {
      source: "backend",
      recommendation_status: response.recommendation_status,
      recommendation_note: response.recommendation_note,
      warning: response.warning,
      crowd_exposure_reduction_percent: response.crowd_exposure_reduction_percent,
      recommended_route_is_distinct: response.recommended_route_is_distinct,
      data_as_of: response.data_as_of,
    },
  };
}

function bannerForRouteCompare(meta) {
  if (!meta || meta.source !== "backend") {
    return { message: "Routes updated", type: "success" };
  }
  switch (meta.recommendation_status) {
    case "LOWER_CROWD":
      return {
        message:
          meta.crowd_exposure_reduction_percent != null
            ? `Recommended route reduces crowd exposure by ${Math.round(meta.crowd_exposure_reduction_percent)}%`
            : meta.recommendation_note || "Recommended route has lower crowd exposure",
        type: "success",
      };
    case "SHORTEST_ALREADY_BEST":
      return {
        message: meta.recommendation_note || "Shortest route is already the best available option",
        type: "info",
      };
    case "INSUFFICIENT_DATA":
      return {
        message: meta.warning || "Limited data — route comparison may be incomplete",
        type: "warn",
      };
    case "NO_ALTERNATIVE":
      return {
        message: meta.warning || "No quieter alternative route found",
        type: "info",
      };
    default:
      return { message: meta.recommendation_note || "Routes updated", type: "success" };
  }
}

async function fetchRoutesUs11FromBackend(origin, destination) {
  const url = new URL(`${API_BASE}/api/v1/routes`);
  url.searchParams.set("origin_latitude", String(origin.latitude));
  url.searchParams.set("origin_longitude", String(origin.longitude));
  url.searchParams.set("destination_latitude", String(destination.latitude));
  url.searchParams.set("destination_longitude", String(destination.longitude));
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw createApiError(res.status, await readApiErrorDetail(res));
  }
  return mapUs11RoutesResponse(await res.json());
}

async function fetchRoutesCompareFromBackend(origin, destination) {
  const res = await fetch(`${API_BASE}/api/v1/routes/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin, destination }),
  });
  if (!res.ok) {
    throw createApiError(res.status, await readApiErrorDetail(res));
  }
  return mapRoutesCompareResponse(await res.json());
}

/**
 * Plan routes: US1.1 GET /routes first; attach US1.2 compare meta when available.
 * Falls back to compare-only, then OSRM demo.
 * Returns { routes, meta }.
 */
async function fetchPlanRoutes(originLat, originLng, dest) {
  const origin = { latitude: originLat, longitude: originLng };
  const destination = { latitude: dest.lat, longitude: dest.lng };

  if (API_BASE) {
    try {
      const us11 = await fetchRoutesUs11FromBackend(origin, destination);
      try {
        const compare = await fetchRoutesCompareFromBackend(origin, destination);
        us11.meta.compare = compare.meta;
        // Prefer compare cards only when US1.2 can actually recommend a quieter route.
        if (
          compare.meta.recommendation_status === "LOWER_CROWD" &&
          compare.meta.recommended_route_is_distinct &&
          Array.isArray(compare.routes) &&
          compare.routes.length
        ) {
          return {
            routes: compare.routes,
            meta: {
              ...compare.meta,
              source: "backend",
              us11_route_count: us11.routes.length,
            },
          };
        }
      } catch (err) {
        console.warn("US1.2 routes/compare unavailable; keeping US1.1 routes.", err);
      }
      return us11;
    } catch (err) {
      console.warn("US1.1 routes API unavailable; trying compare fallback.", err);
      try {
        return await fetchRoutesCompareFromBackend(origin, destination);
      } catch (err2) {
        console.warn("Routes compare API unavailable; using OSRM fallback.", err2);
      }
    }
  }

  const routes = await buildRoadRoutesForDestination(dest);
  return {
    routes,
    meta: { source: "osrm", recommendation_status: null, compare: null },
  };
}

/** @deprecated Prefer fetchPlanRoutes — kept for callers that only need compare. */
async function fetchRoutesCompare(originLat, originLng, dest) {
  return fetchPlanRoutes(originLat, originLng, dest);
}
