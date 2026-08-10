(function () {
  const STORAGE_KEY = "calmpath-threshold";
  const thresholdLabels = ["Low", "Medium", "High"];

  const state = {
    threshold: 0,
    routes: [],
    routeCompareMeta: null,
    selectedRouteId: null,
    destination: null,
    nearbyRefuges: [],
    selectedRefugeId: null,
    /** Page-session cache for GET /api/v1/refuges/address (US2.1) */
    refugeAddressById: {},
    addressRequestId: null,
    /**
     * Search centre for Quiet Refuges.
     * followsOrigin: keep synced with the route starting point until edited.
     */
    refugeLocation: {
      name: DEFAULT_ORIGIN.name,
      lat: DEFAULT_ORIGIN.lat,
      lng: DEFAULT_ORIGIN.lng,
      followsOrigin: true,
    },
    mapMode: "routes",
  };

  const els = {
    views: document.querySelectorAll("[data-view]"),
    navItems: document.querySelectorAll("[data-nav]"),
    routes: document.getElementById("routes"),
    routesSection: document.getElementById("routes-section"),
    refugeList: document.getElementById("refuge-list"),
    refugeLocation: document.getElementById("refuge-location"),
    refugeLocationError: document.getElementById("refuge-location-error"),
    alertsList: document.getElementById("alerts-list"),
    radiusSlider: document.getElementById("radius-slider"),
    radiusValue: document.getElementById("radius-value"),
    thresholdSlider: document.getElementById("threshold-slider"),
    thresholdValue: document.getElementById("threshold-value"),
    destination: document.getElementById("destination"),
    globalSearch: document.getElementById("global-search"),
    findRoute: document.getElementById("find-route"),
    routeError: document.getElementById("route-error"),
    routeBanner: document.getElementById("route-banner"),
    routeBannerText: document.getElementById("route-banner-text"),
    thresholdPanel: document.getElementById("threshold-panel"),
    datalist: document.getElementById("cbd-destinations"),
    modal: document.getElementById("alert-modal"),
    modalTitle: document.getElementById("modal-title"),
    modalMeta: document.getElementById("modal-meta"),
    modalMessage: document.getElementById("modal-message"),
    modalRoutes: document.getElementById("modal-routes"),
    modalRefuges: document.getElementById("modal-refuges"),
    modalClose: document.getElementById("modal-close"),
    originInput: document.getElementById("origin-input"),
  };

  let map;
  let originMarker = null;
  let layers = {
    routes: null,
    busy: null,
    pt: null,
    refuges: null,
    markers: null,
  };

  function setView(name) {
    state.mapMode = name === "refuges" ? "refuges" : name === "alerts" ? "alerts" : "routes";
    els.views.forEach((view) => {
      view.classList.toggle("is-active", view.dataset.view === name);
    });
    els.navItems.forEach((item) => {
      item.classList.toggle("is-active", item.dataset.nav === name);
    });
    if (name === "refuges") {
      loadNearbyRefuges();
    } else {
      refreshMapOverlays();
    }
    if (map) setTimeout(() => map.invalidateSize(), 50);
  }

  function loadThreshold() {
    const saved = localStorage.getItem(STORAGE_KEY);
    const value = saved === null ? 0 : Number(saved);
    state.threshold = Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 0;
    if (els.thresholdSlider) els.thresholdSlider.value = String(state.threshold);
  }

  function saveThreshold(value) {
    state.threshold = value;
    localStorage.setItem(STORAGE_KEY, String(value));
  }

  function updateSliderFill(slider) {
    if (!slider) return;
    const min = Number(slider.min) || 0;
    const max = Number(slider.max) || 100;
    const value = Number(slider.value);
    const percent = ((value - min) / (max - min)) * 100;
    slider.style.setProperty("--slider-fill", `${percent}%`);
  }

  function formatRadius(meters) {
    if (meters >= 1000) {
      const km = meters / 1000;
      return Number.isInteger(km) ? `${km}km` : `${km.toFixed(1)}km`;
    }
    return `${meters}m`;
  }

  function showRefugeLocationError(message) {
    if (!els.refugeLocationError) return;
    els.refugeLocationError.hidden = !message;
    els.refugeLocationError.textContent = message || "";
  }

  function renderRefugeLocationUi() {
    if (els.refugeLocation && document.activeElement !== els.refugeLocation) {
      els.refugeLocation.value = state.refugeLocation.name;
    }
  }

  function setRefugeLocation(place, options = {}) {
    const followsOrigin = Boolean(options.followsOrigin);
    state.refugeLocation = {
      name: place.name || "Custom location",
      lat: place.lat,
      lng: place.lng,
      followsOrigin,
    };
    renderRefugeLocationUi();
  }

  function syncRefugeLocationFromOrigin() {
    if (!state.refugeLocation.followsOrigin) return;
    setRefugeLocation(
      {
        name: ORIGIN.name,
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
      },
      { followsOrigin: true }
    );
  }

  function commitRefugeLocationFromInput() {
    const value = (els.refugeLocation?.value || "").trim();
    if (!value) {
      showRefugeLocationError("Enter a Melbourne CBD place.");
      return false;
    }

    const place = resolveCbdPlace(value);
    if (!place) {
      showRefugeLocationError("Please choose a location within Melbourne CBD.");
      return false;
    }

    showRefugeLocationError("");
    setRefugeLocation(
      {
        name: place.name,
        lat: place.lat,
        lng: place.lng,
      },
      { followsOrigin: false }
    );
    loadNearbyRefuges();
    return true;
  }

  function wireRefugeLocationEditor() {
    els.refugeLocation?.addEventListener("change", () => {
      commitRefugeLocationFromInput();
    });
    els.refugeLocation?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitRefugeLocationFromInput();
      }
    });
  }

  function sensoryLabel(route) {
    if (route.limitedData) return "Limited Data";
    if (route.sensoryClass === "low") return "Low Sensory";
    if (route.sensoryClass === "high") return "High Sensory";
    if (route.sensoryClass === "medium") return "Medium Sensory";
    return "Limited Data";
  }

  function routeColor(route) {
    if (route.sensoryClass === "low") return "#34c759";
    if (route.sensoryClass === "high") return "#ff3b30";
    if (route.sensoryClass === "medium") return "#ffcc00";
    return "#8e8e93";
  }

  function initDatalist() {
    if (!els.datalist || typeof CBD_DESTINATIONS === "undefined") return;
    els.datalist.innerHTML = CBD_DESTINATIONS.map(
      (d) => `<option value="${d.name}"></option>`
    ).join("");
  }

  function syncDestinationInputs(value, source) {
    if (source !== "destination" && els.destination) els.destination.value = value;
    if (source !== "global" && els.globalSearch) els.globalSearch.value = value;
  }

  function showError(message) {
    if (!els.routeError) return;
    els.routeError.hidden = !message;
    els.routeError.textContent = message || "";
  }

  function showBanner(message, type) {
    if (!els.routeBanner) return;
    els.routeBanner.hidden = !message;
    els.routeBanner.className = `banner banner--${type || "success"}`;
    const icon = els.routeBanner.querySelector(".banner__icon");
    if (icon) {
      icon.textContent =
        type === "warn" || type === "danger" ? "🔴" : type === "info" ? "⚪" : "🟢";
    }
    if (els.routeBannerText) els.routeBannerText.textContent = message || "";
  }

  function renderOriginUi() {
    if (els.originInput && document.activeElement !== els.originInput) {
      els.originInput.value = ORIGIN.name;
    }
  }

  function applyOriginChange(place, source) {
    setOrigin({
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      source: source || "custom",
    });
    renderOriginUi();
    updateOriginMarker();
    syncRefugeLocationFromOrigin();
    loadNearbyRefuges();
    if (state.destination) {
      planRoutesTo(state.destination);
    } else {
      refreshMapOverlays();
    }
  }

  function commitOriginFromInput() {
    const value = (els.originInput?.value || "").trim();
    if (!value) {
      showError("Enter a Melbourne CBD starting point.");
      return false;
    }

    const place = resolveCbdPlace(value);
    if (!place) {
      showError("Please choose a starting point within Melbourne CBD.");
      return false;
    }
    showError("");
    const same =
      Math.abs(place.lat - ORIGIN.lat) < 1e-6 &&
      Math.abs(place.lng - ORIGIN.lng) < 1e-6 &&
      place.name === ORIGIN.name;
    if (!same) {
      applyOriginChange(place, "custom");
    } else {
      renderOriginUi();
      updateOriginMarker();
    }
    return true;
  }

  function wireOriginEditor() {
    els.originInput?.addEventListener("change", () => {
      commitOriginFromInput();
    });
    els.originInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitOriginFromInput();
      }
    });
  }

  function updateOriginMarker() {
    if (!map || !layers.markers) return;
    clearGroup(layers.markers);
    originMarker = L.marker([ORIGIN.lat, ORIGIN.lng])
      .addTo(layers.markers)
      .bindPopup(`📍 Start · ${ORIGIN.name}`);
    map.panTo([ORIGIN.lat, ORIGIN.lng]);
  }

  function initMap() {
    if (typeof L === "undefined") return;
    map = L.map("map", {
      zoomControl: true,
      attributionControl: true,
    }).setView([ORIGIN.lat, ORIGIN.lng], 15);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    layers.routes = L.layerGroup().addTo(map);
    layers.busy = L.layerGroup().addTo(map);
    layers.pt = L.layerGroup().addTo(map);
    layers.refuges = L.layerGroup().addTo(map);
    layers.markers = L.layerGroup().addTo(map);

    updateOriginMarker();
    drawBusyZones();
    drawPtStops();
  }

  function clearGroup(group) {
    if (group) group.clearLayers();
  }

  function drawBusyZones() {
    clearGroup(layers.busy);
    if (typeof BUSY_ZONES === "undefined") return;
    BUSY_ZONES.forEach((zone) => {
      L.circle([zone.lat, zone.lng], {
        radius: zone.radius,
        color: "#ff3b30",
        weight: 1,
        fillColor: "#ff3b30",
        fillOpacity: 0.22,
      })
        .bindTooltip(`${zone.label}`, { permanent: false })
        .addTo(layers.busy);
    });
  }

  function drawPtStops() {
    clearGroup(layers.pt);
    if (typeof PT_STOPS === "undefined") return;
    PT_STOPS.forEach((stop) => {
      const icon = L.divIcon({
        className: "map-emoji-icon",
        html: `<span>${stop.icon}</span><small>${stop.type}</small>`,
        iconSize: [40, 36],
        iconAnchor: [20, 18],
      });
      L.marker([stop.lat, stop.lng], { icon })
        .bindPopup(`${stop.icon} ${stop.type} stop`)
        .addTo(layers.pt);
    });
  }

  function drawRoutesOnMap() {
    clearGroup(layers.routes);
    if (!state.routes.length) return;

    const bounds = [];
    state.routes.forEach((route) => {
      const selected = route.id === state.selectedRouteId;
      const style = {
        color: routeColor(route),
        weight: selected ? 6 : 4,
        opacity: selected ? 0.95 : 0.45,
        dashArray: route.sensoryClass === "high" ? "8 8" : null,
      };

      let layer;
      if (route.geometry && route.geometry.type === "LineString") {
        layer = L.geoJSON(route.geometry, { style: () => style }).addTo(layers.routes);
        route.geometry.coordinates.forEach(([lng, lat]) => bounds.push([lat, lng]));
      } else if (route.path?.length) {
        layer = L.polyline(route.path, style).addTo(layers.routes);
        route.path.forEach((p) => bounds.push(p));
      }

      if (layer) {
        layer.on("click", () => selectRouteById(route.id));
      }
    });

    if (state.destination) {
      L.circleMarker([state.destination.lat, state.destination.lng], {
        radius: 8,
        color: "#1c1c1e",
        fillColor: "#ffffff",
        fillOpacity: 1,
        weight: 3,
      })
        .bindPopup(state.destination.name)
        .addTo(layers.routes);
      bounds.push([state.destination.lat, state.destination.lng]);
    }

    if (bounds.length && map) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  function getRefugeAddressStatus(id) {
    return state.refugeAddressById[id] || null;
  }

  function drawRefugesOnMap(items) {
    clearGroup(layers.refuges);
    (items || []).forEach((item) => {
      const selected = item.id === state.selectedRefugeId;
      const addressLine = formatRefugeAddressLine(getRefugeAddressStatus(item.id));
      const icon = L.divIcon({
        className: `map-refuge-icon${selected ? " is-selected" : ""}`,
        html: `<span>${refugeIcon(item.type)}</span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      const popupBits = [
        `<strong>${item.name}</strong>`,
        `${refugeTypeLabel(item.type)} · ${Math.round(item.distance_m)}m`,
      ];
      if (selected && addressLine) popupBits.push(addressLine);
      L.marker([item.latitude, item.longitude], { icon })
        .bindPopup(popupBits.join("<br>"))
        .on("click", () => selectRefuge(item.id))
        .addTo(layers.refuges);
    });
  }

  function refreshMapOverlays() {
    if (!map) return;
    if (state.mapMode === "refuges") {
      clearGroup(layers.routes);
      const nearby = state.nearbyRefuges || [];
      drawRefugesOnMap(nearby);
      if (nearby.length) {
        map.fitBounds(
          nearby
            .map((r) => [r.latitude, r.longitude])
            .concat([[state.refugeLocation.lat, state.refugeLocation.lng]]),
          { padding: [40, 40] }
        );
      }
    } else {
      clearGroup(layers.refuges);
      drawRoutesOnMap();
    }
  }

  function clearRouteResults() {
    state.routes = [];
    state.routeCompareMeta = null;
    state.selectedRouteId = null;
    if (els.routes) els.routes.innerHTML = "";
    if (els.thresholdPanel) {
      els.thresholdPanel.hidden = true;
      els.thresholdPanel.innerHTML = "";
    }
  }

  function showSameLocationNotice(placeName) {
    clearRouteResults();
    showError("Starting point and destination are the same location.");
    const label = placeName ? `"${placeName}"` : "this location";
    showBanner(`You're already at ${label} — choose a different destination.`, "info");
    if (els.routesSection) els.routesSection.hidden = true;
  }

  async function planRoutesTo(dest) {
    if (!dest || !Number.isFinite(dest.lat) || !Number.isFinite(dest.lng)) return;

    state.destination = dest;
    syncDestinationInputs(dest.name || "", "both");

    if (isSameLocation(ORIGIN.lat, ORIGIN.lng, dest.lat, dest.lng)) {
      showSameLocationNotice(dest.name);
      setView("routes");
      refreshMapOverlays();
      return;
    }

    showError("");
    if (els.findRoute) {
      els.findRoute.disabled = true;
      els.findRoute.textContent = "Finding routes…";
    }
    showBanner("Comparing walking routes…", "info");

    try {
      const result = await fetchRoutesCompare(ORIGIN.lat, ORIGIN.lng, dest);
      state.routes = result.routes;
      state.routeCompareMeta = result.meta;
    } catch (err) {
      console.warn(err);
      state.routes = cloneRoutesForDestination(dest);
      state.routeCompareMeta = { source: "fallback", recommendation_status: null };
    } finally {
      if (els.findRoute) {
        els.findRoute.disabled = false;
        els.findRoute.textContent = "Find a route";
      }
    }

    const recommended = state.routes.find((r) => r.recommended) || state.routes[0];
    state.selectedRouteId = recommended?.id || null;

    if (els.routesSection) els.routesSection.hidden = false;

    if (state.routeCompareMeta?.source === "backend") {
      const banner = bannerForRouteCompare(state.routeCompareMeta);
      showBanner(banner.message, banner.type);
    } else {
      const allSnapped = state.routes.every((r) => r.roadSnapped);
      showBanner(
        allSnapped
          ? "Backend unavailable — showing demo walking routes"
          : "Backend unavailable — showing approximate demo paths",
        "warn"
      );
    }

    renderRoutes();
    evaluateThreshold();
    setView("routes");
    refreshMapOverlays();
  }

  function findRoutes() {
    const query = (els.destination?.value || els.globalSearch?.value || "").trim();
    showError("");

    if (!query) {
      showError("Enter a Melbourne CBD destination.");
      return;
    }

    if (!isMelbourneCbdQuery(query)) {
      showError("Please choose a destination within Melbourne CBD.");
      return;
    }

    const originValue = (els.originInput?.value || "").trim();
    const originPlace = resolveCbdPlace(originValue);
    if (!originPlace) {
      showError("Please choose a starting point within Melbourne CBD.");
      return;
    }
    setOrigin({
      name: originPlace.name,
      lat: originPlace.lat,
      lng: originPlace.lng,
      source: "custom",
    });
    renderOriginUi();
    updateOriginMarker();
    syncRefugeLocationFromOrigin();

    const matched = resolveCbdPlace(query) || matchDestination(query);
    if (!matched || !isWithinMelbourneCbd(matched.lat, matched.lng)) {
      showError("Please choose a destination within Melbourne CBD.");
      return;
    }

    planRoutesTo(matched);
  }

  /** Navigate to a refuge via CalmPath Route Planner (no external maps). */
  function navigateToRefuge(refuge) {
    if (!refuge) return;
    planRoutesTo({
      id: refuge.id,
      name: refuge.name,
      lat: refuge.latitude,
      lng: refuge.longitude,
    });
  }

  async function loadNearbyRefuges() {
    if (!els.refugeList || !els.radiusSlider) return;

    const radius_m = Number(els.radiusSlider.value);
    const loc = state.refugeLocation;

    try {
      const results = await fetchNearbyRefuges(loc.lat, loc.lng, radius_m);
      state.nearbyRefuges = results;

      if (!results.length) {
        els.refugeList.innerHTML =
          '<div class="empty"><p class="empty__title">No quiet spaces in this radius</p><p>Try another location or increase the search radius.</p></div>';
        state.selectedRefugeId = null;
        refreshMapOverlays();
        return;
      }

      const stillVisible = results.some((r) => r.id === state.selectedRefugeId);
      if (!stillVisible) {
        state.selectedRefugeId = results[0].id;
      }

      renderRefugeList(results);
      refreshMapOverlays();
      await ensureRefugeAddress(state.selectedRefugeId);
    } catch (err) {
      els.refugeList.innerHTML =
        '<div class="empty"><p class="empty__title">Could not load refuges</p><p>Check location and radius, then try again.</p></div>';
      state.nearbyRefuges = [];
      refreshMapOverlays();
    }
  }

  function renderRefugeList(nearby) {
    els.refugeList.innerHTML = nearby
      .map((item) => {
        const selected = item.id === state.selectedRefugeId;
        const addressLine = selected
          ? formatRefugeAddressLine(getRefugeAddressStatus(item.id))
          : "";
        return `
      <div class="refuge-item${selected ? " is-selected" : ""}" data-refuge="${item.id}">
        <button type="button" class="refuge-item__main" data-select-refuge="${item.id}">
          <span class="refuge-item__icon" aria-hidden="true">${refugeIcon(item.type)}</span>
          <span class="refuge-item__body">
            <span class="refuge-item__name">${item.name}</span>
            <span class="refuge-item__type">${refugeTypeLabel(item.type)}</span>
            ${
              selected && addressLine
                ? `<span class="refuge-item__address">${addressLine}</span>`
                : ""
            }
          </span>
          <span class="refuge-item__distance">${Math.round(item.distance_m)}m</span>
        </button>
        ${
          selected
            ? `<button type="button" class="btn btn--primary btn--block refuge-item__nav" data-navigate-refuge="${item.id}">🧭 Navigate with Route Planner</button>`
            : ""
        }
      </div>`;
      })
      .join("");

    els.refugeList.querySelectorAll("[data-select-refuge]").forEach((btn) => {
      btn.addEventListener("click", () => selectRefuge(btn.dataset.selectRefuge));
    });
    els.refugeList.querySelectorAll("[data-navigate-refuge]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const refuge = state.nearbyRefuges.find((r) => r.id === btn.dataset.navigateRefuge);
        navigateToRefuge(refuge);
      });
    });
  }

  /**
   * US2.1: call /refuges/address only on select; at most one in-flight request per
   * selection; reuse successful page-session cache; no automatic retry loop.
   */
  async function ensureRefugeAddress(id, options = {}) {
    if (!id) return;

    const force = Boolean(options.force);
    const cached = getRefugeAddressStatus(id);

    if (!force && cached && cached.state === "ok") {
      renderRefugeList(state.nearbyRefuges);
      refreshMapOverlays();
      return;
    }
    if (!force && cached && cached.state === "error") {
      renderRefugeList(state.nearbyRefuges);
      refreshMapOverlays();
      return;
    }
    if (!force && cached && cached.state === "loading") return;

    const refuge = state.nearbyRefuges.find((r) => r.id === id);
    if (!refuge) return;

    const requestToken = `${id}:${refuge.latitude},${refuge.longitude}:${Date.now()}`;
    state.addressRequestId = requestToken;

    state.refugeAddressById[id] = { state: "loading" };
    if (state.selectedRefugeId === id) {
      renderRefugeList(state.nearbyRefuges);
      refreshMapOverlays();
    }

    try {
      const data = await fetchRefugeAddress(refuge.latitude, refuge.longitude);
      if (state.addressRequestId === requestToken) {
        state.refugeAddressById[id] = { state: "ok", data };
      }
    } catch (err) {
      if (state.addressRequestId === requestToken) {
        state.refugeAddressById[id] = {
          state: "error",
          status: err.status || 0,
          message: err.detail || err.message,
          retryAfter: err.retryAfter,
        };
      }
    } finally {
      if (state.addressRequestId === requestToken) {
        state.addressRequestId = null;
      }
      if (state.selectedRefugeId === id) {
        renderRefugeList(state.nearbyRefuges);
        refreshMapOverlays();
      }
    }
  }

  function selectRefuge(id) {
    const prevId = state.selectedRefugeId;
    const cached = getRefugeAddressStatus(id);
    state.selectedRefugeId = id;
    renderRefugeList(state.nearbyRefuges);
    refreshMapOverlays();
    // Manual re-click may retry transient errors; never auto-loop. 404 stays cached.
    const force =
      id === prevId &&
      cached &&
      cached.state === "error" &&
      cached.status !== 404;
    ensureRefugeAddress(id, { force });
  }

  function renderRoutes() {
    if (!els.routes) return;
    if (!state.routes.length) {
      els.routes.innerHTML = "";
      return;
    }

    els.routes.innerHTML = state.routes
      .map((route) => {
        const selected = route.id === state.selectedRouteId;
        const badge = route.limitedData ? "limited" : route.sensoryClass;
        return `
      <article class="route-card${selected ? " is-selected" : ""}" data-route="${route.id}" tabindex="0" role="button" aria-pressed="${selected}">
        <div class="route-card__top">
          ${selected ? '<span class="pill pill--selected">✓ Selected</span>' : "<span></span>"}
          ${route.recommended ? '<span class="star" aria-label="Recommended">⭐</span>' : ""}
        </div>
        <div class="route-card__name">
          <span class="route-card__dot route-card__dot--${badge}" aria-hidden="true"></span>
          ${route.name}
        </div>
        <p class="route-card__time">${route.time} · ${route.distance}</p>
        <p class="route-card__label">${sensoryLabel(route)}</p>
        <p class="route-card__note">${route.note}</p>
      </article>`;
      })
      .join("");

    els.routes.querySelectorAll("[data-route]").forEach((card) => {
      card.addEventListener("click", () => selectRouteById(card.dataset.route));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectRouteById(card.dataset.route);
        }
      });
    });
  }

  function selectRouteById(id) {
    state.selectedRouteId = id;
    renderRoutes();
    evaluateThreshold();
    refreshMapOverlays();
  }

  function routesUnderThreshold() {
    return state.routes.filter((r) => !r.limitedData && r.level <= state.threshold);
  }

  function bestAvailableRoute() {
    return [...state.routes].sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      return a.crowdScore - b.crowdScore;
    })[0];
  }

  function evaluateThreshold() {
    if (!els.thresholdPanel) return;
    if (!state.routes.length) {
      els.thresholdPanel.hidden = true;
      els.thresholdPanel.innerHTML = "";
      return;
    }

    const current =
      state.routes.find((r) => r.id === state.selectedRouteId) || state.routes[0];
    const under = routesUnderThreshold();
    const exceeds = current.level > state.threshold;

    if (!exceeds) {
      els.thresholdPanel.hidden = true;
      els.thresholdPanel.innerHTML = "";
      const busyHit = current.sensoryClass === "high";
      if (busyHit) {
        showBanner("Heavy crowd detected on some options. Recommended route avoids busy corridors.", "warn");
      } else if (current.recommended) {
        showBanner("Recommended route updated", "success");
      }
      return;
    }

    els.thresholdPanel.hidden = false;

    if (under.length) {
      const alt = under.sort((a, b) => a.crowdScore - b.crowdScore)[0];
      showBanner("Heavy crowd detected. Route updated.", "warn");
      els.thresholdPanel.innerHTML = `
        <div class="threshold-card threshold-card--warn">
          <p class="threshold-card__title">⚠️ Threshold Exceeded</p>
          <p>Current route density is higher than your preferred threshold.</p>
          <div class="threshold-card__current">
            <strong>${current.name}</strong>
            <span class="badge badge--${current.sensoryClass}">${sensoryLabel(current)}</span>
            <span class="muted">Above Threshold</span>
          </div>
        </div>
        <div class="threshold-card threshold-card--ok">
          <p class="threshold-card__title">🟢 Alternative Found</p>
          <p><strong>${alt.name}</strong> · ${alt.time} · ${alt.distance}</p>
          <p class="muted">${sensoryLabel(alt)} · Avoids busy corridors · Matches your preference</p>
          <button type="button" class="btn btn--primary btn--block" data-switch-route="${alt.id}">Switch to ${alt.name}</button>
        </div>`;
    } else {
      const best = bestAvailableRoute();
      showBanner("No route fully matches your preference.", "info");
      els.thresholdPanel.innerHTML = `
        <div class="threshold-card threshold-card--warn">
          <p class="threshold-card__title">⚠️ Threshold Exceeded</p>
          <p>All available routes are above your threshold.</p>
          <div class="threshold-card__current">
            <strong>${current.name}</strong>
            <span class="badge badge--${current.sensoryClass}">${sensoryLabel(current)}</span>
          </div>
        </div>
        <div class="threshold-card threshold-card--best">
          <p class="threshold-card__title">⭐ Best Available</p>
          <p><strong>${best.name}</strong> · ${best.time} · ${best.distance}</p>
          <p class="muted">${sensoryLabel(best)} · Best available option</p>
          <div class="threshold-card__actions">
            <button type="button" class="btn btn--secondary" data-nav="settings">Adjust Threshold</button>
            <button type="button" class="btn btn--primary" data-switch-route="${best.id}">Continue</button>
          </div>
        </div>`;
    }

    els.thresholdPanel.querySelectorAll("[data-switch-route]").forEach((btn) => {
      btn.addEventListener("click", () => selectRouteById(btn.dataset.switchRoute));
    });
    els.thresholdPanel.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.dataset.nav));
    });
  }

  function renderAlerts() {
    if (!els.alertsList || typeof predictiveAlerts === "undefined") return;
    els.alertsList.innerHTML = predictiveAlerts
      .map(
        (alert) => `
      <article class="card alert-card" data-alert="${alert.id}">
        <div class="card__row">
          <div>
            <p class="card__title">${alert.location}</p>
            <p class="card__meta">Predicted Time · ${alert.timeframe}</p>
          </div>
          <span class="badge badge--${alert.crowdClass}"><span class="badge__icon" aria-hidden="true">${
            alert.crowdClass === "high" ? "🔴" : alert.crowdClass === "medium" ? "🟡" : "🟢"
          }</span> ${alert.crowdLevel}</span>
        </div>
        <p class="card__meta" style="margin-top:8px">${alert.message}</p>
        <div class="card__foot">
          <button type="button" class="btn btn--ghost btn--sm btn--block" data-alert-action="open" data-alert="${alert.id}">Details</button>
        </div>
      </article>`
      )
      .join("");

    els.alertsList.querySelectorAll("[data-alert-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const alert = predictiveAlerts.find((a) => a.id === btn.dataset.alert);
        if (alert) openAlertModal(alert);
      });
    });
  }

  function openAlertModal(alert) {
    if (!els.modal) return;
    els.modalTitle.textContent = alert.location;
    els.modalMeta.innerHTML = `
      <div><dt>Location</dt><dd>${alert.location}</dd></div>
      <div><dt>Predicted Time</dt><dd>${alert.timeframe}</dd></div>
      <div><dt>Crowd Level</dt><dd>${alert.crowdLevel}</dd></div>`;
    els.modalMessage.textContent = alert.message;
    els.modal.hidden = false;
    els.modal.classList.add("is-open");
  }

  function closeAlertModal() {
    if (!els.modal) return;
    els.modal.hidden = true;
    els.modal.classList.remove("is-open");
  }

  function goToQuieterRoutes() {
    closeAlertModal();
    if (!state.routes.length) {
      if (els.destination && !els.destination.value) {
        els.destination.value = "State Library Victoria";
        syncDestinationInputs("State Library Victoria", "both");
      }
      findRoutes();
    } else {
      const quiet = [...state.routes].sort((a, b) => a.crowdScore - b.crowdScore)[0];
      selectRouteById(quiet.id);
      setView("routes");
    }
  }

  function wireRadiusSlider() {
    if (!els.radiusSlider || !els.radiusValue) return;
    const sync = () => {
      const meters = Number(els.radiusSlider.value);
      els.radiusValue.textContent = formatRadius(meters);
      els.radiusSlider.setAttribute("aria-valuenow", String(meters));
      updateSliderFill(els.radiusSlider);
      if (state.mapMode === "refuges" || document.getElementById("view-refuges")?.classList.contains("is-active")) {
        loadNearbyRefuges();
      }
    };
    els.radiusSlider.addEventListener("input", sync);
    sync();
  }

  function wireThresholdSlider() {
    if (!els.thresholdSlider || !els.thresholdValue) return;
    const sync = () => {
      const index = Number(els.thresholdSlider.value);
      const label = thresholdLabels[index] || "Low";
      els.thresholdValue.textContent = label;
      els.thresholdSlider.setAttribute("aria-valuenow", String(index));
      els.thresholdSlider.setAttribute("aria-valuetext", label);
      updateSliderFill(els.thresholdSlider);
      saveThreshold(index);
      evaluateThreshold();
    };
    els.thresholdSlider.addEventListener("input", sync);
    sync();
  }

  function wireSearch() {
    els.destination?.addEventListener("input", () => {
      syncDestinationInputs(els.destination.value, "destination");
      showError("");
    });
    els.globalSearch?.addEventListener("input", () => {
      syncDestinationInputs(els.globalSearch.value, "global");
      showError("");
    });
    els.globalSearch?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        findRoutes();
      }
    });
    els.destination?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        findRoutes();
      }
    });
  }

  els.navItems.forEach((item) => {
    item.addEventListener("click", () => setView(item.dataset.nav));
  });

  els.findRoute?.addEventListener("click", findRoutes);
  els.modalClose?.addEventListener("click", closeAlertModal);
  els.modalRoutes?.addEventListener("click", goToQuieterRoutes);
  els.modalRefuges?.addEventListener("click", () => {
    closeAlertModal();
    setView("refuges");
  });
  els.modal?.addEventListener("click", (event) => {
    if (event.target === els.modal) closeAlertModal();
  });

  document.addEventListener("DOMContentLoaded", () => {
    loadThreshold();
    initDatalist();
    setOrigin({
      name: DEFAULT_ORIGIN.name,
      lat: DEFAULT_ORIGIN.lat,
      lng: DEFAULT_ORIGIN.lng,
      source: "default",
    });
    setRefugeLocation(
      {
        name: DEFAULT_ORIGIN.name,
        lat: DEFAULT_ORIGIN.lat,
        lng: DEFAULT_ORIGIN.lng,
      },
      { followsOrigin: true }
    );
    initMap();
    wireSearch();
    wireOriginEditor();
    wireRefugeLocationEditor();
    wireRadiusSlider();
    wireThresholdSlider();
    renderAlerts();
    renderOriginUi();
    renderRefugeLocationUi();
    loadNearbyRefuges();
  });
})();
