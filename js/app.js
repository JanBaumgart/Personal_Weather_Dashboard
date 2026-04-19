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

  // ---------- Favorites ----------
  const FAV_KEY = 'weather_favorites';
  const FAV_MAX = 8;

  function loadFavorites() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (e) { return []; }
  }
  function _saveFavorites(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) { /* quota */ }
  }
  function isFavorite(loc) {
    return loadFavorites().some(function (f) {
      return Math.abs(f.lat - loc.lat) < 0.01 && Math.abs(f.lon - loc.lon) < 0.01;
    });
  }
  function addFavorite(loc) {
    var list = loadFavorites();
    if (list.some(function (f) { return Math.abs(f.lat - loc.lat) < 0.01 && Math.abs(f.lon - loc.lon) < 0.01; })) return;
    var displayName = loc.displayName || (loc.name + ', ' + loc.country);
    list.push({ name: loc.name, country: loc.country, lat: loc.lat, lon: loc.lon, timezone: loc.timezone || 'Europe/Berlin', displayName: displayName });
    list.sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    if (list.length > FAV_MAX) list = list.slice(0, FAV_MAX);
    _saveFavorites(list);
  }
  function removeFavorite(loc) {
    var list = loadFavorites().filter(function (f) {
      return !(Math.abs(f.lat - loc.lat) < 0.01 && Math.abs(f.lon - loc.lon) < 0.01);
    });
    _saveFavorites(list);
  }
  function toggleFavorite(loc) {
    if (isFavorite(loc)) { removeFavorite(loc); return false; }
    addFavorite(loc); return true;
  }

  function updateSubtitleStar() {
    var btn = document.getElementById('subtitle-fav-btn');
    if (!btn) return;
    var fav = isFavorite(WeatherAPI.getLocation());
    btn.textContent = fav ? '\u2605' : '\u2606';
    btn.classList.toggle('active', fav);
    btn.title = fav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern';
  }

  /**
   * Fetch weather data and render every section.
   * On failure, show the error banner but leave any previously-rendered data intact.
   */
  async function loadAndRender() {
    lastLoadTime = Date.now();
    WeatherUI.setRefreshing(true);
    WeatherUI.clearActiveHour();
    WeatherMap.resetRadarFrame();
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
  let _debounceTimer      = null;

  function pickLocation(loc) {
    hideSuggestions();
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    WeatherAPI.setLocation(loc);
    WeatherUI.setTimezone(loc.timezone);
    WeatherMap.moveMarker(loc.lat, loc.lon, loc.name);
    updateLabels(loc);
    updateSubtitleStar();
    loadAndRender();
  }

  function _buildSuggestionItem(r, isFav) {
    var li = document.createElement('li');
    li.className = 'search-suggestion-item';
    li.setAttribute('role', 'option');
    li.setAttribute('tabindex', '0');

    var nameSpan = document.createElement('span');
    nameSpan.className = 'suggestion-name';
    nameSpan.textContent = r.displayName || (r.name + ', ' + r.country);
    li.appendChild(nameSpan);

    var starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = 'suggestion-star' + (isFav ? ' active' : '');
    starBtn.textContent = isFav ? '\u2605' : '\u2606';
    starBtn.setAttribute('aria-label', isFav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern');
    starBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var nowFav = toggleFavorite(r);
      starBtn.textContent = nowFav ? '\u2605' : '\u2606';
      starBtn.classList.toggle('active', nowFav);
      starBtn.setAttribute('aria-label', nowFav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern');
      updateSubtitleStar();
      // If viewing favorites and this one was removed, refresh the dropdown
      if (!nowFav) {
        var input = document.getElementById('search-input');
        if (input && !input.value.trim()) showFavoritesDropdown();
      }
    });
    li.appendChild(starBtn);

    li.addEventListener('click', function (e) {
      if (e.target === starBtn) return;
      pickLocation(r);
    });
    li.addEventListener('keydown', function (e) {
      var list = document.getElementById('search-suggestions');
      var items = list ? Array.from(list.querySelectorAll('.search-suggestion-item')) : [];
      var idx   = items.indexOf(li);
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickLocation(r); }
      if (e.key === 'ArrowDown') { e.preventDefault(); var next = items[idx + 1]; if (next) next.focus(); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); var prev = items[idx - 1]; if (prev) prev.focus(); else document.getElementById('search-input').focus(); }
    });
    return li;
  }

  function showSuggestions(results) {
    const list = document.getElementById('search-suggestions');
    if (!list) return;
    list.innerHTML = '';
    results.forEach(function (r) {
      list.appendChild(_buildSuggestionItem(r, isFavorite(r)));
    });
    list.hidden = false;
    _suggestionsVisible = true;
  }

  function showFavoritesDropdown() {
    var list = document.getElementById('search-suggestions');
    if (!list) return;
    var favs = loadFavorites();
    if (!favs.length) { hideSuggestions(); return; }
    list.innerHTML = '';
    var header = document.createElement('li');
    header.className = 'search-suggestions-header';
    header.setAttribute('role', 'presentation');
    header.textContent = 'Favoriten';
    list.appendChild(header);
    favs.forEach(function (f) {
      list.appendChild(_buildSuggestionItem(f, true));
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

  async function handleSearch(query, isLive) {
    const q = String(query || '').trim();
    if (!q) return;
    hideSuggestions();
    const btn = document.getElementById('search-btn');
    if (!isLive && btn) btn.classList.add('loading');
    var results;
    try {
      results = await WeatherAPI.geocode(q);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[WeatherDashboard] Geocode failed:', err);
      if (!isLive) showSearchStatus('Suche fehlgeschlagen.');
      return;
    } finally {
      if (!isLive && btn) btn.classList.remove('loading');
    }
    if (!results || results.length === 0) {
      showSearchStatus('Kein Ort gefunden.');
      return;
    }
    // On explicit submit with exactly one result: auto-pick. Live search always shows list.
    if (results.length === 1 && !isLive) {
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
      if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
      handleSearch(input.value);
    });

    // Show favorites on focus when input is empty
    input.addEventListener('focus', function () {
      if (!input.value.trim()) showFavoritesDropdown();
    });

    // Live suggestions while typing (debounced 300 ms)
    input.addEventListener('input', function () {
      const q = input.value.trim();
      if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
      if (!q || q.length < 2) { hideSuggestions(); if (!q) showFavoritesDropdown(); return; }
      _debounceTimer = setTimeout(function () { handleSearch(q, true); }, 300);
    });

    // Close suggestions on outside click
    document.addEventListener('click', function (e) {
      if (_suggestionsVisible && !form.parentNode.contains(e.target)) {
        hideSuggestions();
      }
    });

    // ESC closes suggestions
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; } hideSuggestions(); }
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

    // Subtitle star button
    var favBtn = document.getElementById('subtitle-fav-btn');
    if (favBtn) {
      favBtn.addEventListener('click', function () {
        toggleFavorite(WeatherAPI.getLocation());
        updateSubtitleStar();
      });
    }
    updateSubtitleStar();

    initSearch();
    WeatherUI.initHourlyToggle();
    WeatherUI.initHourlyMapClick();
    try { WeatherMap.initAnimation(); } catch (e) { /* no radar available */ }
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
