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
  const FAV_KEY      = 'weather_favorites';
  const FAV_MAX      = 8;
  const LAST_LOC_KEY = 'weather_last_location';

  /**
   * Validate a favorite entry's shape before trusting it.
   * localStorage is writable by other tabs / devtools / malicious extensions — a
   * corrupt entry with non-numeric lat/lon would propagate NaN into Leaflet and
   * into API URLs, so we filter aggressively on load.
   */
  var _IANA_TZ_RE = /^[A-Za-z_]+(?:\/[A-Za-z_0-9+\-]+){0,2}$/;

  function _isValidFavorite(f) {
    return f && typeof f === 'object'
      && typeof f.name === 'string' && f.name.length > 0 && f.name.length <= 100
      && typeof f.country === 'string' && f.country.length <= 10
      && typeof f.lat === 'number' && isFinite(f.lat) && f.lat >= -90 && f.lat <= 90
      && typeof f.lon === 'number' && isFinite(f.lon) && f.lon >= -180 && f.lon <= 180
      && (f.timezone === undefined || (typeof f.timezone === 'string' && f.timezone.length <= 50 && _IANA_TZ_RE.test(f.timezone)))
      && (f.displayName === undefined || (typeof f.displayName === 'string' && f.displayName.length <= 200));
  }

  function _sameLoc(a, b) {
    return Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
  }

  function loadFavorites() {
    try {
      var raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter(_isValidFavorite);
    } catch (e) { return []; }
  }
  function _saveFavorites(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) { /* quota */ }
  }

  function _saveLastLocation(loc) {
    try {
      localStorage.setItem(LAST_LOC_KEY, JSON.stringify({
        name: loc.name, country: loc.country, lat: loc.lat, lon: loc.lon,
        timezone: loc.timezone || 'Europe/Berlin',
        displayName: loc.displayName
      }));
    } catch (e) { /* quota */ }
  }

  function _loadLastLocation() {
    try {
      var raw = JSON.parse(localStorage.getItem(LAST_LOC_KEY));
      if (_isValidFavorite(raw)) return raw;
    } catch (e) { /* ignore */ }
    return null;
  }
  function isFavorite(loc) {
    return loadFavorites().some(function (f) { return _sameLoc(f, loc); });
  }
  function addFavorite(loc) {
    var list = loadFavorites();
    if (list.some(function (f) { return _sameLoc(f, loc); })) return;
    var displayName = loc.displayName || (loc.name + ', ' + loc.country);
    list.push({ name: loc.name, country: loc.country, lat: loc.lat, lon: loc.lon, timezone: loc.timezone || 'Europe/Berlin', displayName: displayName });
    list.sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    if (list.length > FAV_MAX) list = list.slice(0, FAV_MAX);
    _saveFavorites(list);
  }
  function removeFavorite(loc) {
    var list = loadFavorites().filter(function (f) { return !_sameLoc(f, loc); });
    _saveFavorites(list);
  }
  /**
   * Read localStorage only once per toggle (previously: isFavorite + add/remove = 2 reads).
   * Mutates an in-memory list and persists once at the end.
   */
  function toggleFavorite(loc) {
    var list  = loadFavorites();
    var idx   = -1;
    for (var i = 0; i < list.length; i++) {
      if (_sameLoc(list[i], loc)) { idx = i; break; }
    }
    if (idx >= 0) {
      list.splice(idx, 1);
      _saveFavorites(list);
      return false;
    }
    var displayName = loc.displayName || (loc.name + ', ' + loc.country);
    list.push({ name: loc.name, country: loc.country, lat: loc.lat, lon: loc.lon, timezone: loc.timezone || 'Europe/Berlin', displayName: displayName });
    list.sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    if (list.length > FAV_MAX) list = list.slice(0, FAV_MAX);
    _saveFavorites(list);
    return true;
  }

  async function _syncFavMarkers() {
    const favs = loadFavorites();
    const weatherMap = {};
    await Promise.allSettled(favs.map(async function(fav) {
      try {
        const key = fav.lat.toFixed(4) + ',' + fav.lon.toFixed(4);
        const w = await WeatherAPI.fetchCurrentForLoc(fav);
        weatherMap[key] = w;
      } catch (e) { /* silent fail — marker still shows without weather */ }
    }));
    WeatherMap.setFavMarkers(favs, weatherMap);
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
      const [weatherResult, alertsResult, aqiResult] = await Promise.allSettled([
        WeatherAPI.fetchWeather(),
        WeatherAPI.fetchAlerts(),
        WeatherAPI.fetchAqi()
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
      _syncFavMarkers(); // fire-and-forget: refreshes fav marker icons + tooltips

      const aqiData = aqiResult.status === 'fulfilled' ? aqiResult.value : null;
      WeatherMap.setAqiData(aqiData);
      WeatherUI.updateAqiBadge(aqiData);
      if (aqiData) WeatherUI.renderAqiChart(aqiData);

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

  async function useMyLocation() {
    var btn = document.getElementById('gps-btn');
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    try {
      const pos = await new Promise(function (resolve, reject) {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 10000,
          maximumAge: 60000
        });
      });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const info = await WeatherAPI.reverseGeocode(lat, lon);
      pickLocation({
        name:        info.name,
        country:     info.country,
        lat:         lat,
        lon:         lon,
        timezone:    info.timezone,
        displayName: info.name + (info.country ? ', ' + info.country : '')
      });
    } catch (err) {
      var msg = 'Standort konnte nicht ermittelt werden.';
      if (err && err.code === 1) msg = 'GPS-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben.';
      else if (err && err.code === 3) msg = 'GPS-Timeout. Bitte erneut versuchen.';
      showSearchStatus(msg);
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    }
  }

  function pickLocation(loc) {
    hideSuggestions();
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    WeatherAPI.setLocation(loc);
    _saveLastLocation(loc);
    WeatherUI.setTimezone(loc.timezone);
    WeatherMap.setTimezone(loc.timezone);
    WeatherMap.moveMarker(loc.lat, loc.lon, loc.name);
    updateLabels(loc);
    updateSubtitleStar();
    _syncFavMarkers();
    loadAndRender();
  }

  function _buildSuggestionItem(r, isFav) {
    const li = document.createElement('li');
    li.className = 'search-suggestion-item';
    li.setAttribute('role', 'option');
    li.setAttribute('tabindex', '0');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'suggestion-name';
    nameSpan.textContent = r.displayName || (r.name + ', ' + r.country);
    li.appendChild(nameSpan);

    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = 'suggestion-star' + (isFav ? ' active' : '');
    starBtn.textContent = isFav ? '\u2605' : '\u2606';
    starBtn.setAttribute('aria-label', isFav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern');
    starBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const nowFav = toggleFavorite(r);
      starBtn.textContent = nowFav ? '\u2605' : '\u2606';
      starBtn.classList.toggle('active', nowFav);
      starBtn.setAttribute('aria-label', nowFav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern');
      updateSubtitleStar();
      _syncFavMarkers();
      // If viewing favorites and this one was removed, refresh the dropdown
      if (!nowFav) {
        const inp = document.getElementById('search-input');
        if (inp && !inp.value.trim()) showFavoritesDropdown();
      }
    });
    li.appendChild(starBtn);

    li.addEventListener('click', function (e) {
      if (e.target === starBtn) return;
      pickLocation(r);
    });
    li.addEventListener('keydown', function (e) {
      const list  = document.getElementById('search-suggestions');
      const items = list ? Array.from(list.querySelectorAll('.search-suggestion-item')) : [];
      const idx   = items.indexOf(li);
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickLocation(r); }
      if (e.key === 'ArrowDown') { e.preventDefault(); const next = items[idx + 1]; if (next) next.focus(); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); const prev = items[idx - 1]; if (prev) prev.focus(); else document.getElementById('search-input').focus(); }
    });
    return li;
  }

  function showSuggestions(results) {
    const list = document.getElementById('search-suggestions');
    if (!list) return;
    const favs = loadFavorites();
    list.innerHTML = '';
    results.forEach(function (r) {
      list.appendChild(_buildSuggestionItem(r, favs.some(function(f){ return _sameLoc(f, r); })));
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
    const form  = document.getElementById('search-form');
    const input = document.getElementById('search-input');
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
        const first = document.querySelector('#search-suggestions .search-suggestion-item');
        if (first) first.focus();
      }
    });
  }

  /**
   * Initialise the map once, then start the data loop.
   */
  function init() {
    // Deep-link: ?lat=48.1&lon=11.6&name=München&country=DE&timezone=Europe/Berlin
    const params = new URLSearchParams(window.location.search);
    const pLat  = parseFloat(params.get('lat'));
    const pLon  = parseFloat(params.get('lon'));
    const pName = String(params.get('name') || '').trim().slice(0, 100);
    if (isFinite(pLat) && pLat >= -90 && pLat <= 90 &&
        isFinite(pLon) && pLon >= -180 && pLon <= 180 && pName) {
      const urlLoc = {
        name:     pName,
        country:  String(params.get('country')  || '').trim().slice(0, 10),
        lat:      pLat,
        lon:      pLon,
        timezone: String(params.get('timezone') || 'Europe/Berlin').slice(0, 50)
      };
      WeatherAPI.setLocation(urlLoc);
      _saveLastLocation(urlLoc);
      WeatherUI.setTimezone(urlLoc.timezone);
      WeatherMap.setTimezone(urlLoc.timezone);
      updateLabels(urlLoc);
    } else {
      const saved = _loadLastLocation();
      if (saved) {
        WeatherAPI.setLocation(saved);
        WeatherUI.setTimezone(saved.timezone);
        WeatherMap.setTimezone(saved.timezone);
        updateLabels(saved);
      }
    }

    const loc = WeatherAPI.getLocation();
    try {
      WeatherMap.initMap({ lat: loc.lat, lon: loc.lon });
      WeatherMap.initMapExpand();
      WeatherMap.initCloudLayer();
      WeatherMap.initRadarLayer();
      _syncFavMarkers();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[WeatherDashboard] Map init failed:', err);
    }

    // Fav-marker click navigates to that location
    document.addEventListener('wd:pick-location', function(e) {
      pickLocation(e.detail);
    });

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
        _syncFavMarkers();
      });
    }
    updateSubtitleStar();

    var gpsBtn = document.getElementById('gps-btn');
    if (gpsBtn) {
      if (!navigator.geolocation) {
        gpsBtn.style.display = 'none';
      } else {
        gpsBtn.addEventListener('click', useMyLocation);
      }
    }

    initSearch();
    WeatherUI.initHourlyToggle();
    WeatherUI.initHourlyMapClick();
    WeatherMap.initAnimation();
    WeatherMap.initAqiLayer();

    // AQI card mirrors the map AQI toggle — start hidden, flip on 'wd:aqi-toggle'.
    WeatherUI.setAqiCardVisible(false);
    document.addEventListener('wd:aqi-toggle', function (e) {
      WeatherUI.setAqiCardVisible(e.detail.on);
    });

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
