/* ==========================================================================
   map.js — Leaflet map initialisation
   ========================================================================== */

/* global L, window */

(function () {
  'use strict';

  let mapInstance    = null;
  let markerInstance = null;
  var _favMarkers    = {}; // key: "lat.toFixed(4),lon.toFixed(4)"

  var _overlayOpacity = { cloud: 0, radar: 0 };
  var _overlayLayers  = { cloud: null, radar: null };

  // Frame scrubbing / animation state
  var _allFrames           = [];   // [{time (unix s), path}, ...] past + nowcast combined
  var _pastFrameCount      = 0;
  var _liveFramePath       = null;
  var _currentHost         = null;
  var _framePinned         = false;
  var _cloudHiddenForFrame = false;
  var _cloudBtnRef         = null;
  var _animBtn             = null;
  var _animTimerId         = null;
  var _animIdx             = 0;
  var _timeOverlayTz  = 'Europe/Berlin';

  // Wraps Intl.DateTimeFormat; on RangeError (invalid tz) falls back to
  // Europe/Berlin so a corrupt tz string never crashes the radar time overlay.
  function _safeTimeOverlayFmt(tz) {
    try {
      return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
    } catch (e) {
      return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Berlin' });
    }
  }
  var _timeOverlayFmt = _safeTimeOverlayFmt(_timeOverlayTz);

  var _aqiOn      = false;
  var _aqiOverlay = null;
  var _aqiData    = null;

  function setTimezone(tz) {
    _timeOverlayTz  = String(tz || 'Europe/Berlin').slice(0, 50);
    _timeOverlayFmt = _safeTimeOverlayFmt(_timeOverlayTz);
  }

  // ---------- AQI overlay ----------
  // AQI color/label lookup is provided by window.WeatherAPI.aqiColorInfo
  // (single source of truth, shared with ui.js).

  function _getOrCreateAqiEl() {
    if (!mapInstance) return null;
    var wrap = mapInstance.getContainer().parentElement;
    if (!wrap) return null;
    var el = wrap.querySelector('.map-aqi-overlay');
    if (!el) {
      el = document.createElement('div');
      el.className = 'map-aqi-overlay';
      wrap.appendChild(el);
    }
    return el;
  }

  function _updateAqiOverlay() {
    if (!mapInstance || !markerInstance) return;
    if (!_aqiOn) {
      if (_aqiOverlay) { mapInstance.removeLayer(_aqiOverlay); _aqiOverlay = null; }
      var offEl = _getOrCreateAqiEl();
      if (offEl) offEl.classList.remove('map-aqi-overlay--visible');
      return;
    }
    var eaqi = _aqiData && _aqiData.current ? _aqiData.current.eaqi : null;
    var info = window.WeatherAPI.aqiColorInfo(eaqi);
    if (!info) return;
    var pos = markerInstance.getLatLng();
    if (_aqiOverlay) {
      _aqiOverlay.setLatLng(pos);
      _aqiOverlay.setStyle({ color: info.color, fillColor: info.color });
    } else {
      _aqiOverlay = L.circleMarker(pos, {
        radius: 55, color: info.color, fillColor: info.color,
        fillOpacity: 0.12, opacity: 0.65, weight: 2
      }).addTo(mapInstance);
    }
    var onEl = _getOrCreateAqiEl();
    if (onEl) {
      onEl.textContent = 'AQI ' + Math.round(eaqi) + ' · ' + info.label;
      onEl.style.color = info.color;
      onEl.classList.add('map-aqi-overlay--visible');
    }
  }

  function setAqiData(aqiData) {
    _aqiData = aqiData;
    if (_aqiOn) _updateAqiOverlay();
  }

  function initAqiLayer() {
    var btn = document.getElementById('map-aqi-btn');
    if (!btn || !mapInstance) return;
    btn.setAttribute('data-state', '1');
    btn.setAttribute('aria-label', 'Luftqualität anzeigen');
    btn.addEventListener('click', function () {
      _aqiOn = !_aqiOn;
      btn.setAttribute('data-state', _aqiOn ? '0' : '1');
      btn.setAttribute('aria-label', _aqiOn ? 'Luftqualität ausblenden' : 'Luftqualität anzeigen');
      _updateAqiOverlay();
      document.dispatchEvent(new CustomEvent('wd:aqi-toggle', { detail: { on: _aqiOn } }));
    });
  }

  // ---------- Map init ----------
  function initMap(opts) {
    if (mapInstance) return mapInstance;

    const options   = opts || {};
    const nuremberg = [options.lat || 49.45, options.lon || 11.08];

    mapInstance = L.map('map', {
      center:             [51.2, 10.4],
      zoom:               6,
      minZoom:            4,
      maxZoom:            18,
      zoomControl:        true,
      attributionControl: true,
      scrollWheelZoom:    false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(mapInstance);

    const weatherIcon = L.divIcon({
      html:        '<div class="weather-marker">⛅</div>',
      className:   '',
      iconSize:    [40, 40],
      iconAnchor:  [20, 20],
      popupAnchor: [0, -20]
    });

    markerInstance = L.marker(nuremberg, { icon: weatherIcon }).addTo(mapInstance);
    markerInstance.bindTooltip('Nürnberg', { permanent: false, direction: 'top' });
    markerInstance.bindPopup(_buildPopupEl('Nürnberg', 'Bayern, Deutschland', '49.45° N, 11.08° E'));

    L.control.scale({ position: 'bottomright', imperial: false }).addTo(mapInstance);

    const container = mapInstance.getContainer();
    container.addEventListener('mouseenter', function () { mapInstance.scrollWheelZoom.enable(); });
    container.addEventListener('mouseleave', function () { mapInstance.scrollWheelZoom.disable(); });

    mapInstance.on('zoomend', function () {
      var z        = mapInstance.getZoom();
      var overZoom = z > 12;
      var hasActive = _overlayOpacity.cloud > 0 || _overlayOpacity.radar > 0;
      if (overZoom) {
        if (_overlayLayers.cloud) _overlayLayers.cloud.setOpacity(0);
        if (_overlayLayers.radar) _overlayLayers.radar.setOpacity(0);
        if (hasActive) _showMapToast(container.parentElement, 'Wetter-Overlays bei dieser Zoomstufe ausgeblendet');
      } else {
        if (_overlayLayers.cloud) _overlayLayers.cloud.setOpacity(_overlayOpacity.cloud);
        if (_overlayLayers.radar) _overlayLayers.radar.setOpacity(_overlayOpacity.radar);
      }
    });

    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function (entries) {
        if (entries[0].contentRect.width > 0) { mapInstance.invalidateSize(); ro.disconnect(); }
      });
      ro.observe(container);
    } else {
      setTimeout(function () { if (mapInstance) mapInstance.invalidateSize(); }, 300);
    }

    return mapInstance;
  }

  // ---------- Toast ----------
  function _showMapToast(mapWrap, msg) {
    var toast = mapWrap.querySelector('.map-zoom-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'map-zoom-toast';
      mapWrap.appendChild(toast);
    }
    toast.textContent = msg;
    if (toast._hideTimer) clearTimeout(toast._hideTimer);
    toast.classList.remove('map-zoom-toast--visible');
    void toast.offsetWidth;
    toast.classList.add('map-zoom-toast--visible');
    toast._hideTimer = setTimeout(function () { toast.classList.remove('map-zoom-toast--visible'); }, 3000);
  }

  // ---------- Popup helpers ----------
  function _buildPopupEl(name, sub, coords) {
    var el   = document.createElement('div');
    var bold = document.createElement('strong');
    bold.textContent = name;
    el.appendChild(bold);
    el.appendChild(document.createElement('br'));
    el.appendChild(document.createTextNode(sub));
    el.appendChild(document.createElement('br'));
    el.appendChild(document.createTextNode(coords));
    return el;
  }

  function moveMarker(lat, lon, name) {
    if (!mapInstance || !markerInstance) return;
    const latlng = L.latLng(lat, lon);
    markerInstance.setLatLng(latlng);
    markerInstance.setTooltipContent(name);
    markerInstance.setPopupContent(
      _buildPopupEl(name, '', lat.toFixed(2) + '° N, ' + lon.toFixed(2) + '° E')
    );
    mapInstance.flyTo(latlng, 10, { duration: 1.2 });
    if (_aqiOverlay) _aqiOverlay.setLatLng(latlng);
  }

  function updateMarkerPopup(current, locationName) {
    if (!markerInstance || !current) return;
    const name     = locationName || 'Wetter';
    const temp     = Math.round(current.temperature);
    const icon     = current.description ? current.description.icon  : '';
    const desc     = current.description ? current.description.label : '';
    var el         = document.createElement('div');
    var bold       = document.createElement('strong');
    var iconSpan   = document.createElement('span');
    bold.textContent     = name;
    iconSpan.className   = 'popup-weather-icon';
    iconSpan.textContent = icon;
    el.appendChild(bold);
    el.appendChild(document.createElement('br'));
    el.appendChild(iconSpan);
    el.appendChild(document.createTextNode(' ' + temp + '\u00B0C \u00B7 ' + desc));
    markerInstance.setPopupContent(el);
  }

  // ---------- Cloud layer ----------
  function _setupCloudLayer(btn, key) {
    _cloudBtnRef = btn;

    var opacities = [1.0, 0.6, 0];
    var labels    = ['Wolken dimmen', 'Wolken ausblenden', 'Wolken einblenden'];
    var state     = 0;
    var tileUrl   = 'https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=' + key;

    var cloudLayer = L.tileLayer(tileUrl, {
      opacity: opacities[state], maxZoom: 18, maxNativeZoom: 14,
      attribution: 'Wolken: <a href="https://openweathermap.org" target="_blank" rel="noopener noreferrer">OpenWeatherMap</a>'
    });
    cloudLayer.addTo(mapInstance);
    _overlayLayers.cloud  = cloudLayer;
    _overlayOpacity.cloud = opacities[state];
    _syncLayerBtn(btn, state, labels);

    btn.addEventListener('click', function () {
      state = (state + 1) % opacities.length;
      cloudLayer.setOpacity(opacities[state]);
      _overlayOpacity.cloud = opacities[state];
      _syncLayerBtn(btn, state, labels);
    });
  }

  function initCloudLayer() {
    var btn = document.getElementById('map-cloud-btn');
    if (!btn || !mapInstance) return;

    var localKey = window.WD_CONFIG && window.WD_CONFIG.owmApiKey;
    if (localKey) { _setupCloudLayer(btn, localKey); return; }

    fetch('/api/owm-key')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.key) _setupCloudLayer(btn, data.key);
        else btn.hidden = true;
      })
      .catch(function () { btn.hidden = true; });
  }

  // ---------- Radar layer ----------
  var TRANSPARENT_PX   = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  var RADAR_REFRESH_MS = 5 * 60 * 1000;
  var SAMPLE_TILE_Z = 6, SAMPLE_TILE_X = 33, SAMPLE_TILE_Y = 21;

  function _buildRadarUrl(host, path) {
    return host + path + '/256/{z}/{x}/{y}/2/1_1.png';
  }

  // NOTE: Canvas/getImageData-based error-tile detection was removed intentionally —
  // CORS caching inconsistencies caused false positives regardless of heuristic tuning.
  // The reliable fix is `maxNativeZoom: 7` on the radar layer (see _startOrRefresh).
  // This probe now only verifies HTTP availability of a reference tile.
  function _probeRadarTile(tileUrlTemplate) {
    return new Promise(function (resolve, reject) {
      var url = tileUrlTemplate
        .replace('{z}', String(SAMPLE_TILE_Z))
        .replace('{x}', String(SAMPLE_TILE_X))
        .replace('{y}', String(SAMPLE_TILE_Y))
        + '?_=' + Date.now();
      var img = new Image();
      var done = false;
      var timeout = setTimeout(function () { if (!done) { done = true; reject(new Error('probe timeout')); } }, 6000);
      img.onload  = function () { if (!done) { done = true; clearTimeout(timeout); resolve(); } };
      img.onerror = function () { if (!done) { done = true; clearTimeout(timeout); reject(new Error('probe load failed')); } };
      img.src = url;
    });
  }

  function initRadarLayer() {
    var btn = document.getElementById('map-radar-btn');
    if (!btn || !mapInstance) return;

    var radarLayer     = null;
    var opacities      = [0.7, 0.3, 0];
    var labels         = ['Niederschlag dimmen', 'Niederschlag ausblenden', 'Niederschlag einblenden'];
    var state          = 0;
    var refreshTimerId = null;

    function _disableLayer() {
      if (radarLayer && mapInstance.hasLayer(radarLayer)) mapInstance.removeLayer(radarLayer);
      radarLayer = null;
      _overlayLayers.radar  = null;
      _overlayOpacity.radar = 0;
      btn.hidden = true;
      if (refreshTimerId) { clearInterval(refreshTimerId); refreshTimerId = null; }
    }

    function _fetchFrameUrl() {
      var ctrl  = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
      return fetch('https://api.rainviewer.com/public/weather-maps.json', ctrl ? { signal: ctrl.signal } : {})
        .then(function (r) {
          if (timer) clearTimeout(timer);
          if (!r.ok) throw new Error('RainViewer ' + r.status);
          return r.json();
        })
        .then(function (data) {
          var host = data.host;
          if (typeof host !== 'string' || !/^https:\/\/tilecache\.rainviewer\.com/.test(host))
            throw new Error('unexpected RainViewer host: ' + host);
          var frames  = data.radar && data.radar.past;
          var nowcast = data.radar && data.radar.nowcast;
          if (!frames || frames.length === 0) throw new Error('no radar data');
          _currentHost    = host;
          _pastFrameCount = frames.length;
          _allFrames      = frames.concat(nowcast || []);
          var latest      = frames[frames.length - 1];
          _liveFramePath  = latest.path;
          return _buildRadarUrl(host, latest.path);
        });
    }

    function _startOrRefresh(tileUrl, isInitial) {
      if (!radarLayer) {
        radarLayer = L.tileLayer(tileUrl, {
          opacity: opacities[state], maxZoom: 18, maxNativeZoom: 7, crossOrigin: 'anonymous',
          attribution: 'Radar: <a href="https://www.rainviewer.com" target="_blank" rel="noopener noreferrer">RainViewer</a>'
        });
        radarLayer.on('tileerror', function (ev) { if (ev.tile) ev.tile.src = TRANSPARENT_PX; });
        radarLayer.addTo(mapInstance);
        _overlayLayers.radar  = radarLayer;
        _overlayOpacity.radar = opacities[state];
        _syncLayerBtn(btn, state, labels);
      } else if (!isInitial && !_framePinned && !_animTimerId) {
        // Only update live frame if not pinned or animating
        radarLayer.setUrl(tileUrl, false);
      }
    }

    function _loadFrame(isInitial) {
      return _fetchFrameUrl().then(function (tileUrl) {
        return _probeRadarTile(tileUrl).then(function () {
          _startOrRefresh(tileUrl, isInitial);
        });
      });
    }

    _loadFrame(true).catch(function () { if (!radarLayer) _disableLayer(); });

    if (refreshTimerId) { clearInterval(refreshTimerId); refreshTimerId = null; }
    var _failCount = 0;
    refreshTimerId = setInterval(function () {
      _loadFrame(false).then(function () { _failCount = 0; }).catch(function () {
        if (++_failCount >= 5) { clearInterval(refreshTimerId); refreshTimerId = null; }
      });
    }, RADAR_REFRESH_MS);

    btn.addEventListener('click', function () {
      state = (state + 1) % opacities.length;
      if (radarLayer) radarLayer.setOpacity(opacities[state]);
      _overlayOpacity.radar = opacities[state];
      _syncLayerBtn(btn, state, labels);
    });
  }

  function _syncLayerBtn(btn, state, labels) {
    btn.setAttribute('data-state', state);
    btn.setAttribute('aria-label', labels[state]);
  }

  // ---------- Time overlay ----------
  function _getOrCreateTimeOverlay() {
    if (!mapInstance) return null;
    var wrap = mapInstance.getContainer().parentElement;
    if (!wrap) return null;
    var el = wrap.querySelector('.map-time-overlay');
    if (!el) {
      el = document.createElement('div');
      el.className = 'map-time-overlay';
      wrap.appendChild(el);
    }
    return el;
  }

  function _showTimeOverlay(tsSeconds, isNowcast) {
    var el = _getOrCreateTimeOverlay();
    if (!el) return;
    var d = new Date(tsSeconds * 1000);
    el.textContent = _timeOverlayFmt.format(d) + ' Uhr' + (isNowcast ? ' · Prognose' : '');
    el.classList.toggle('map-time-overlay--nowcast', !!isNowcast);
    el.classList.add('map-time-overlay--visible');
  }

  function _hideTimeOverlay() {
    var el = _getOrCreateTimeOverlay();
    if (el) el.classList.remove('map-time-overlay--visible');
  }

  // ---------- Shared reset helper ----------
  function _doReset() {
    if (_liveFramePath && _overlayLayers.radar && _currentHost) {
      _overlayLayers.radar.setUrl(_buildRadarUrl(_currentHost, _liveFramePath), false);
    }
    _hideTimeOverlay();
    if (_cloudHiddenForFrame) {
      _cloudHiddenForFrame = false;
      if (_cloudBtnRef) _cloudBtnRef.style.display = '';
      if (_overlayLayers.cloud) _overlayLayers.cloud.setOpacity(_overlayOpacity.cloud);
    }
  }

  // ---------- Frame scrubbing (public) ----------
  function setRadarFrame(msTimestamp) {
    var tsSeconds = msTimestamp > 1e10 ? Math.round(msTimestamp / 1000) : msTimestamp;
    if (!_allFrames.length || !_overlayLayers.radar || !_currentHost) return false;

    var closest = _allFrames.reduce(function (a, b) {
      return Math.abs(b.time - tsSeconds) < Math.abs(a.time - tsSeconds) ? b : a;
    });

    if (Math.abs(closest.time - tsSeconds) > 6000) {
      var wrap = mapInstance && mapInstance.getContainer().parentElement;
      if (wrap) _showMapToast(wrap, 'Keine Radardaten für diese Zeit verfügbar');
      return false;
    }

    // Stop running animation without resetting the frame
    if (_animTimerId) {
      clearInterval(_animTimerId);
      _animTimerId = null;
      if (_animBtn) {
        _animBtn.classList.remove('playing');
        _animBtn.setAttribute('aria-label', 'Radar-Animation abspielen');
        var lbl = _animBtn.querySelector('.anim-label');
        if (lbl) lbl.textContent = '▶ Abspielen';
      }
    }

    _framePinned = true;
    _overlayLayers.radar.setUrl(_buildRadarUrl(_currentHost, closest.path), false);
    _showTimeOverlay(closest.time);

    if (!_cloudHiddenForFrame) {
      _cloudHiddenForFrame = true;
      if (_cloudBtnRef) _cloudBtnRef.style.display = 'none';
      if (_overlayLayers.cloud) _overlayLayers.cloud.setOpacity(0);
    }

    return true;
  }

  function resetRadarFrame() {
    if (_animTimerId) { clearInterval(_animTimerId); _animTimerId = null; }
    if (_animBtn) {
      _animBtn.classList.remove('playing');
      _animBtn.setAttribute('aria-label', 'Radar-Animation abspielen');
      var lbl = _animBtn.querySelector('.anim-label');
      if (lbl) lbl.textContent = '▶ Abspielen';
    }
    _framePinned = false;
    _doReset();
  }

  // ---------- Animation ----------
  function _startAnimation() {
    if (!_allFrames.length || !_overlayLayers.radar || !_currentHost) return;
    _animIdx     = 0;
    _framePinned = false;

    if (!_cloudHiddenForFrame) {
      _cloudHiddenForFrame = true;
      if (_cloudBtnRef) _cloudBtnRef.style.display = 'none';
      if (_overlayLayers.cloud) _overlayLayers.cloud.setOpacity(0);
    }

    if (_animBtn) {
      _animBtn.classList.add('playing');
      _animBtn.setAttribute('aria-label', 'Animation stoppen');
      var lbl = _animBtn.querySelector('.anim-label');
      if (lbl) lbl.textContent = '⏹ Stopp';
    }

    function playFrame() {
      if (_animIdx >= _allFrames.length) { _stopAnimation(); return; }
      var frame = _allFrames[_animIdx++];
      _overlayLayers.radar.setUrl(_buildRadarUrl(_currentHost, frame.path), false);
      _showTimeOverlay(frame.time, _animIdx > _pastFrameCount);
    }

    playFrame();
    _animTimerId = setInterval(playFrame, 1000);
  }

  function _stopAnimation() {
    if (_animTimerId) { clearInterval(_animTimerId); _animTimerId = null; }
    if (_animBtn) {
      _animBtn.classList.remove('playing');
      _animBtn.setAttribute('aria-label', 'Radar-Animation abspielen');
      var lbl = _animBtn.querySelector('.anim-label');
      if (lbl) lbl.textContent = '▶ Abspielen';
    }
    _doReset();
  }

  function initAnimation() {
    if (!mapInstance) return;
    var wrap = mapInstance.getContainer().parentElement;
    if (!wrap || wrap.querySelector('.map-anim-btn')) return;

    var btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'map-anim-btn';
    btn.setAttribute('aria-label', 'Radar-Animation abspielen');
    btn.innerHTML = '<span class="anim-label">▶ Abspielen</span>';
    wrap.appendChild(btn);
    _animBtn = btn;

    btn.addEventListener('click', function () {
      if (_animTimerId) _stopAnimation();
      else              _startAnimation();
    });
  }

  // ---------- Map expand ----------
  function initMapExpand() {
    var btn     = document.getElementById('map-expand-btn');
    var mapCard = btn && btn.closest('.map-card');
    var rowEl   = mapCard && mapCard.closest('.row-two-col');
    if (!btn || !mapCard) return;

    btn.addEventListener('click', function () {
      var expanded = mapCard.classList.toggle('map-expanded');
      if (rowEl) rowEl.classList.toggle('map-row-expanded', expanded);
      btn.setAttribute('aria-expanded', String(expanded));
      btn.setAttribute('aria-label', expanded ? 'Karte verkleinern' : 'Karte maximieren');
      setTimeout(function () { if (mapInstance) mapInstance.invalidateSize(); }, 320);
    });
  }

  function _favIcon(weatherIcon) {
    var icon = weatherIcon || '&#9733;';
    return L.divIcon({
      className: '',
      html: '<div class="fav-marker">' + icon + '</div>',
      iconSize:    [28, 28],
      iconAnchor:  [14, 14],
      popupAnchor: [0, -16]
    });
  }

  function setFavMarkers(favorites, weatherMap) {
    if (!mapInstance) return;
    Object.keys(_favMarkers).forEach(function(k) {
      mapInstance.removeLayer(_favMarkers[k]);
    });
    _favMarkers = {};
    if (!Array.isArray(favorites)) return;
    var wm = weatherMap || {};
    favorites.forEach(function(fav) {
      if (markerInstance) {
        var pos = markerInstance.getLatLng();
        if (Math.abs(pos.lat - fav.lat) < 0.01 && Math.abs(pos.lng - fav.lon) < 0.01) return;
      }
      var key = fav.lat.toFixed(4) + ',' + fav.lon.toFixed(4);
      var w = wm[key];
      var weatherIcon = w ? w.description.icon : null;
      var m = L.marker([fav.lat, fav.lon], { icon: _favIcon(weatherIcon) });

      var tooltipEl = document.createElement('div');
      var nameDiv = document.createElement('div');
      nameDiv.textContent = fav.displayName || (fav.name + (fav.country ? ', ' + fav.country : ''));
      tooltipEl.appendChild(nameDiv);
      if (w) {
        var weatherDiv = document.createElement('span');
        weatherDiv.className = 'fav-tt-weather';
        weatherDiv.textContent = w.description.icon + ' ' + Math.round(w.temperature) + '\u00B0 \u00B7 ' + w.description.label;
        tooltipEl.appendChild(weatherDiv);
      }
      m.bindTooltip(tooltipEl, { direction: 'top', offset: [0, -8] });
      m.on('click', function() {
        document.dispatchEvent(new CustomEvent('wd:pick-location', { detail: fav }));
      });
      m.addTo(mapInstance);
      _favMarkers[key] = m;
    });
  }

  window.WeatherMap = {
    initMap:           initMap,
    initMapExpand:     initMapExpand,
    initCloudLayer:    initCloudLayer,
    initRadarLayer:    initRadarLayer,
    initAnimation:     initAnimation,
    moveMarker:        moveMarker,
    updateMarkerPopup: updateMarkerPopup,
    setRadarFrame:     setRadarFrame,
    resetRadarFrame:   resetRadarFrame,
    setFavMarkers:     setFavMarkers,
    setTimezone:       setTimezone,
    initAqiLayer:      initAqiLayer,
    setAqiData:        setAqiData
  };
})();
