/* CalmPath — US2.1 refuge API client
 *
 * The deployed FastAPI backend is the primary source. Direct City of Melbourne
 * open data remains available as a development fallback:
 *   - primary: Park/Garden/Reserve → park, Library → library
 *   - address: nearest street-addresses within 200 m
 *
 * Response shapes match US2.1_API.md.
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
    const detail = await res.text();
    throw createApiError(res.status, detail || res.statusText);
  }
  return res.json();
}

async function fetchRefugeAddressFromBackend(latitude, longitude) {
  const url = new URL(`${API_BASE}/api/v1/refuges/address`);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  const res = await fetch(url.toString());
  if (res.status === 404) {
    throw createApiError(404, "No valid street address within 200 m of this location");
  }
  if (!res.ok) {
    const retryAfter = res.headers.get("Retry-After");
    throw createApiError(res.status, await res.text(), retryAfter);
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
