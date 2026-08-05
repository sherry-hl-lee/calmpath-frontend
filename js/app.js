(function () {
  const views = document.querySelectorAll("[data-view]");
  const navItems = document.querySelectorAll("[data-nav]");
  const routesEl = document.getElementById("routes");
  const refugeListEl = document.getElementById("refuge-list");
  const radiusSlider = document.getElementById("radius-slider");
  const radiusValue = document.getElementById("radius-value");
  const thresholdSlider = document.getElementById("threshold-slider");
  const thresholdValue = document.getElementById("threshold-value");

  const thresholdLabels = ["Low", "Medium", "High"];

  function setView(name) {
    views.forEach((view) => {
      view.classList.toggle("is-active", view.dataset.view === name);
    });
    navItems.forEach((item) => {
      item.classList.toggle("is-active", item.dataset.nav === name);
    });
  }

  navItems.forEach((item) => {
    item.addEventListener("click", () => setView(item.dataset.nav));
  });

  function updateSliderFill(slider) {
    if (!slider) return;
    const min = Number(slider.min) || 0;
    const max = Number(slider.max) || 100;
    const value = Number(slider.value);
    const percent = ((value - min) / (max - min)) * 100;
    slider.style.setProperty("--slider-fill", `${percent}%`);
  }

  function formatRadius(meters) {
    if (meters >= 1000) return "1km";
    return `${meters}m`;
  }

  function sensoryLabel(route) {
    if (route.sensoryClass === "low") return "Low Sensory";
    if (route.sensoryClass === "high") return "High Sensory";
    if (route.sensoryClass === "medium") return "Medium Sensory";
    return "Limited Data";
  }

  function renderRoutes() {
    if (!routesEl || typeof routes === "undefined") return;

    routesEl.innerHTML = routes
      .map(
        (route, index) => `
      <article class="route-card${index === 0 ? " is-selected" : ""}" data-route="${route.id}" tabindex="0" role="button" aria-pressed="${index === 0}">
        <div class="route-card__top">
          ${index === 0 ? '<span class="pill pill--selected">✓ Selected</span>' : "<span></span>"}
          ${route.recommended ? '<span class="star" aria-label="Recommended">⭐</span>' : ""}
        </div>
        <div class="route-card__name">
          <span class="route-card__dot route-card__dot--${route.sensoryClass}" aria-hidden="true"></span>
          ${route.name}
        </div>
        <p class="route-card__time">${route.time}</p>
        <p class="route-card__label">${sensoryLabel(route)}</p>
      </article>`
      )
      .join("");

    routesEl.querySelectorAll("[data-route]").forEach((card) => {
      card.addEventListener("click", () => selectRoute(card));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectRoute(card);
        }
      });
    });
  }

  function selectRoute(card) {
    routesEl.querySelectorAll("[data-route]").forEach((el) => {
      el.classList.remove("is-selected");
      el.setAttribute("aria-pressed", "false");
      const top = el.querySelector(".route-card__top");
      if (top) {
        const star = top.querySelector(".star");
        top.innerHTML = "<span></span>";
        if (star) top.appendChild(star);
      }
    });

    card.classList.add("is-selected");
    card.setAttribute("aria-pressed", "true");
    const top = card.querySelector(".route-card__top");
    if (top) {
      const star = top.querySelector(".star");
      top.innerHTML = '<span class="pill pill--selected">✓ Selected</span>';
      if (star) top.appendChild(star);
      else if (card.dataset.route === "a") {
        top.insertAdjacentHTML(
          "beforeend",
          '<span class="star" aria-label="Recommended">⭐</span>'
        );
      }
    }
  }

  function renderRefuges() {
    if (!refugeListEl || typeof refuges === "undefined" || !radiusSlider) return;

    const radius = Number(radiusSlider.value);
    const nearby = refuges.filter((item) => item.distance <= radius);

    if (!nearby.length) {
      refugeListEl.innerHTML =
        '<div class="empty"><p class="empty__title">No quiet spaces in this radius</p><p>Try increasing the search radius.</p></div>';
      return;
    }

    refugeListEl.innerHTML = nearby
      .map(
        (item, index) => `
      <button type="button" class="refuge-item${index === 0 ? " is-selected" : ""}" data-refuge="${item.id}">
        <span class="refuge-item__icon" aria-hidden="true">${item.icon}</span>
        <span>
          <span class="refuge-item__name">${item.name}</span>
          <span class="refuge-item__type">${item.type}</span>
          ${index === 0 ? `<span class="refuge-item__address">${item.address}</span>` : ""}
        </span>
        <span class="refuge-item__distance">${item.distance}m</span>
      </button>`
      )
      .join("");

    refugeListEl.querySelectorAll("[data-refuge]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const selected = refuges.find((r) => r.id === btn.dataset.refuge);
        refugeListEl.querySelectorAll(".refuge-item").forEach((el) => {
          el.classList.remove("is-selected");
          const addr = el.querySelector(".refuge-item__address");
          if (addr) addr.remove();
        });
        btn.classList.add("is-selected");
        if (selected) {
          const mid = btn.children[1];
          if (mid && !mid.querySelector(".refuge-item__address")) {
            const address = document.createElement("span");
            address.className = "refuge-item__address";
            address.textContent = selected.address;
            mid.appendChild(address);
          }
        }
      });
    });
  }

  function wireRadiusSlider() {
    if (!radiusSlider || !radiusValue) return;

    const sync = () => {
      const meters = Number(radiusSlider.value);
      radiusValue.textContent = formatRadius(meters);
      radiusSlider.setAttribute("aria-valuenow", String(meters));
      updateSliderFill(radiusSlider);
      renderRefuges();
    };

    radiusSlider.addEventListener("input", sync);
    sync();
  }

  function wireThresholdSlider() {
    if (!thresholdSlider || !thresholdValue) return;

    const sync = () => {
      const index = Number(thresholdSlider.value);
      const label = thresholdLabels[index] || "Low";
      thresholdValue.textContent = label;
      thresholdSlider.setAttribute("aria-valuenow", String(index));
      thresholdSlider.setAttribute("aria-valuetext", label);
      updateSliderFill(thresholdSlider);
    };

    thresholdSlider.addEventListener("input", sync);
    sync();
  }

  const findRouteBtn = document.getElementById("find-route");
  if (findRouteBtn) {
    findRouteBtn.addEventListener("click", () => {
      setView("routes");
      renderRoutes();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderRoutes();
    wireRadiusSlider();
    wireThresholdSlider();
  });
})();
