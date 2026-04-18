/* ==========================================================================
   app.js — Application bootstrap & orchestration
   ========================================================================== */

/* global window, document, WeatherAPI, WeatherMap, WeatherUI */

(function () {
  'use strict';

  const REFRESH_MS        = 10 * 60 * 1000;
  const MIN_RELOAD_GAP_MS = 30 * 1000;
  let refreshTimer  = null;
  let lastLoadTime  = 0;

  /**
   * Fetch weather data and render every section.
   * On failure, show the error banner but leave any previously-rendered data intact.
   */
  async function loadAndRender() {
    lastLoadTime = Date.now();
    WeatherUI.setRefreshing(true);
    try {
      const [weatherResult, alertsResult] = await Promise.allSettled([
        WeatherAPI.fetchWeather(),
        WeatherAPI.fetchAlerts()
      ]);

      if (weatherResult.status === 'rejected') {
        throw weatherResult.reason;
      }

      const data = weatherResult.value;
      WeatherUI.hideError();
      WeatherUI.renderHero(data);
      WeatherUI.renderSun(data);
      WeatherUI.renderHourly(data);
      WeatherUI.renderTempChart(data);
      WeatherUI.renderDaily(data);
      WeatherUI.renderUpdatedAt(data.fetchedAt);
      WeatherMap.updateMarkerPopup(data.current, data.location && data.location.name);

      if (alertsResult.status === 'fulfilled') {
        WeatherUI.renderAlerts(alertsResult.value);
      } else {
        // eslint-disable-next-line no-console
        console.warn('[WeatherDashboard] Alerts fetch failed:', alertsResult.reason);
        WeatherUI.renderAlerts([]);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[WeatherDashboard] Fetch failed:', err);
      WeatherUI.showError('Wetterdaten konnten nicht geladen werden. Bitte versuche es erneut.');
    } finally {
      WeatherUI.setRefreshing(false);
    }
  }

  // ---------- Location labels ----------
  function updateLabels(loc) {
    const subtitle = document.getElementById('subtitle');
    if (subtitle) subtitle.textContent = 'Live-Wetter für ' + loc.name + ', ' + loc.country;
    document.title = 'Weather Dashboard \u2014 ' + loc.name;
    const mapSub = document.querySelector('.map-card .card-sub');
    if (mapSub) mapSub.textContent = loc.name + ' auf der Karte';
    const dailySub = document.querySelector('.daily-card .card-sub');
    if (dailySub) dailySub.textContent = loc.name + ' \u00B7 Tag anklicken für Details';
    const alertsSub = document.querySelector('#alerts-section .card-sub');
    if (alertsSub) alertsSub.textContent = 'Offizielle DWD-Warnungen für ' + loc.name;
  }

  // ---------- Search ----------
  let _suggestionsVisible = false;

  function pickLocation(loc) {
    hideSuggestions();
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    WeatherAPI.setLocation(loc);
    WeatherMap.moveMarker(loc.lat, loc.lon, loc.name);
    updateLabels(loc);
    loadAndRender();
  }

  function showSuggestions(results) {
    const list = document.getElementById('search-suggestions');
    if (!list) return;
    list.innerHTML = '';
    results.forEach(function (r, i) {
      var li = document.createElement('li');
      li.className = 'search-suggestion-item';
      li.setAttribute('role', 'option');
      li.setAttribute('tabindex', '0');
      li.textContent = r.displayName;
      li.addEventListener('click', function () { pickLocation(r); });
      li.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickLocation(r); }
        if (e.key === 'ArrowDown') { e.preventDefault(); var next = list.children[i + 1]; if (next) next.focus(); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); var prev = list.children[i - 1]; if (prev) prev.focus(); else document.getElementById('search-input').focus(); }
      });
      list.appendChild(li);
    });
    list.hidden = false;
    _suggestionsVisible = true;
  }

  function hideSuggestions() {
    const list = document.getElementById('search-suggestions');
    if (list) { list.hidden = true; list.innerHTML = ''; }
    _suggestionsVisible = false;
  }

  function showSearchStatus(msg) {
    var list = document.getElementById('search-suggestions');
    if (!list) return;
    list.innerHTML = '';
    var li = document.createElement('li');
    li.className = 'search-suggestion-item search-status';
    li.textContent = msg;
    list.appendChild(li);
    list.hidden = false;
    _suggestionsVisible = true;
  }

  async function handleSearch(query) {
    const q = String(query || '').trim();
    if (!q) return;
    hideSuggestions();
    const btn = document.getElementById('search-btn');
    if (btn) btn.classList.add('loading');
    var results;
    try {
      results = await WeatherAPI.geocode(q);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[WeatherDashboard] Geocode failed:', err);
      showSearchStatus('Suche fehlgeschlagen.');
      return;
    } finally {
      if (btn) btn.classList.remove('loading');
    }
    if (!results || results.length === 0) {
      showSearchStatus('Kein Ort gefunden.');
      return;
    }
    if (results.length === 1) {
      pickLocation(results[0]);
      return;
    }
    showSuggestions(results);
  }

  function initSearch() {
    var form  = document.getElementById('search-form');
    var input = document.getElementById('search-input');
    if (!form || !input) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      handleSearch(input.value);
    });

    // Close suggestions on outside click
    document.addEventListener('click', function (e) {
      if (_suggestionsVisible && !form.parentNode.contains(e.target)) {
        hideSuggestions();
      }
    });

    // ESC closes suggestions
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideSuggestions();
      if (e.key === 'ArrowDown' && _suggestionsVisible) {
        e.preventDefault();
        var first = document.querySelector('#search-suggestions .search-suggestion-item');
        if (first) first.focus();
      }
    });
  }

  /**
   * Initialise the map once, then start the data loop.
   */
  function init() {
    const loc = WeatherAPI.getLocation();
    try {
      WeatherMap.initMap({ lat: loc.lat, lon: loc.lon });
      WeatherMap.initMapExpand();
      WeatherMap.initCloudLayer();
      WeatherMap.initRadarLayer();
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

    initSearch();
    WeatherUI.initHourlyToggle();
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
          if (Date.now() - lastLoadTime >= MIN_RELOAD_GAP_MS) {
            loadAndRender();
          }
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
