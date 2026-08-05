(function () {
  const views = document.querySelectorAll("[data-view]");
  const navItems = document.querySelectorAll("[data-nav]");
  const routesEl = document.getElementById("routes");
  const thresholdChips = document.querySelectorAll("#threshold-chips .chip");
  const radiusChips = document.querySelectorAll('#view-refuges .chips .chip');

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

  function renderRoutes() {
    if (!routesEl || typeof routes === "undefined") return;

    routesEl.innerHTML = routes
      .map(
        (route, index) => `
      <article class="card card--interactive${index === 0 ? " is-selected" : ""}" data-route="${route.id}" tabindex="0" role="button" aria-pressed="${index === 0}">
        <div class="card__row">
          <div>
            <p class="card__title">${route.name}</p>
            <p class="card__meta">${route.time} · ${route.distance}</p>
          </div>
          <span class="badge badge--${route.sensoryClass}">${route.sensory}</span>
        </div>
        <div class="card__foot">
          ${route.recommended ? '<span class="badge badge--recommended">Recommended</span>' : ""}
          <span class="card__meta">${route.note}</span>
        </div>
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
    });
    card.classList.add("is-selected");
    card.setAttribute("aria-pressed", "true");
  }

  function wireChips(nodeList) {
    nodeList.forEach((chip) => {
      chip.addEventListener("click", () => {
        nodeList.forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
      });
    });
  }

  wireChips(thresholdChips);
  wireChips(radiusChips);

  const findRouteBtn = document.getElementById("find-route");
  if (findRouteBtn) {
    findRouteBtn.addEventListener("click", () => {
      setView("routes");
      renderRoutes();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderRoutes();
  });
})();
