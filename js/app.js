/* ==========================================================================
   app.js — Application bootstrap & orchestration
   ========================================================================== */

/* global window, document, WeatherAPI, WeatherMap, WeatherUI */

(function () {
  'use strict';

  // Auto-refresh every 10 minutes so the dashboard stays current if left open.
  const REFRESH_MS = 10 * 60 * 1000;
  let refreshTimer = null;

  /**
   * Fetch weather data and render every section.
   * On failure, show the error banner but leave any previously-rendered data intact.
   */
  async function loadAndRender() {
    WeatherUI.setRefreshing(true);
    try {
      const data = await WeatherAPI.fetchWeather();
      WeatherUI.hideError();
      WeatherUI.renderHero(data);
      WeatherUI.renderSun(data);
      WeatherUI.renderHourly(data);
      WeatherUI.renderDaily(data);
      WeatherUI.renderUpdatedAt(data.fetchedAt);
      WeatherMap.updateMarkerPopup(data.current);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[WeatherDashboard] Fetch failed:', err);
      WeatherUI.showError('Wetterdaten konnten nicht geladen werden. Bitte versuche es erneut.');
    } finally {
      WeatherUI.setRefreshing(false);
    }
  }

  /**
   * Initialise the map once, then start the data loop.
   */
  function init() {
    try {
      WeatherMap.initMap({
        lat: WeatherAPI.LOCATION.lat,
        lon: WeatherAPI.LOCATION.lon
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[WeatherDashboard] Map init failed:', err);
    }

    // Wire up refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        loadAndRender();
      });
    }

    loadAndRender();

    // Start periodic refresh
    refreshTimer = window.setInterval(loadAndRender, REFRESH_MS);

    // Pause/resume auto-refresh when tab visibility changes to save on requests.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (refreshTimer) {
          window.clearInterval(refreshTimer);
          refreshTimer = null;
        }
      } else {
        if (!refreshTimer) {
          loadAndRender();
          refreshTimer = window.setInterval(loadAndRender, REFRESH_MS);
        }
      }
    });
  }

  // Run once the DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
