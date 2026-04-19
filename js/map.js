/* ==========================================================================
   map.js — Leaflet map initialisation
   ========================================================================== */

/* global L, window */

(function () {
  'use strict';

  let mapInstance    = null;
  let markerInstance = null;

  // Tracks opacity of each overlay so the zoom-toast only appears when
  // at least one layer is actually visible.
  var _overlayOpacity = { cloud: 0, radar: 0 };
  var _overlayLayers  = { cloud: null, radar: null };

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
      iconSize:    [40, 40],
      iconAnchor:  [20, 20],
      popupAnchor: [0, -20]
    });

    markerInstance = L.marker(nuremberg, { icon: weatherIcon }).addTo(mapInstance);
    markerInstance.bindTooltip('Nürnberg', { permanent: false, direction: 'top' });
    markerInstance.bindPopup(_buildPopupEl('Nürnberg', 'Bayern, Deutschland', '49.45° N, 11.08° E'));

    L.control.scale({ position: 'bottomright', imperial: false }).addTo(mapInstance);

    // Scroll-zoom: enable on container mouseenter, disable on mouseleave.
    const container = mapInstance.getContainer();
    container.addEventListener('mouseenter', function () {
      mapInstance.scrollWheelZoom.enable();
    });
    container.addEventListener('mouseleave', function () {
      mapInstance.scrollWheelZoom.disable();
    });

    // At very high zoom levels, overlay data is too low-resolution to be useful.
    // Hide and show a hint; restore when zooming back out.
    mapInstance.on('zoomend', function () {
      var z         = mapInstance.getZoom();
      var overZoom  = z > 12;
      var hasActive = _overlayOpacity.cloud > 0 || _overlayOpacity.radar > 0;

      if (overZoom) {
        if (_overlayLayers.cloud) _overlayLayers.cloud.setOpacity(0);
        if (_overlayLayers.radar) _overlayLayers.radar.setOpacity(0);
        if (hasActive) _showZoomToast(container.parentElement);
      } else {
        if (_overlayLayers.cloud) _overlayLayers.cloud.setOpacity(_overlayOpacity.cloud);
        if (_overlayLayers.radar) _overlayLayers.radar.setOpacity(_overlayOpacity.radar);
      }
    });

    // ResizeObserver fires once the container has a real size.
    if (typeof ResizeObserver !== 'undefined') {
      var resizeObserver = new ResizeObserver(function (entries) {
        if (entries[0].contentRect.width > 0) {
          mapInstance.invalidateSize();
          resizeObserver.disconnect();
        }
      });
      resizeObserver.observe(container);
    } else {
      setTimeout(function () { if (mapInstance) mapInstance.invalidateSize(); }, 300);
    }

    return mapInstance;
  }

  function _showZoomToast(mapWrap) {
    var toast = mapWrap.querySelector('.map-zoom-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className  = 'map-zoom-toast';
      toast.textContent = 'Wetter-Overlays bei dieser Zoomstufe ausgeblendet';
      mapWrap.appendChild(toast);
    }
    if (toast._hideTimer) clearTimeout(toast._hideTimer);
    toast.classList.remove('map-zoom-toast--visible');
    void toast.offsetWidth; // force reflow so transition re-triggers
    toast.classList.add('map-zoom-toast--visible');
    toast._hideTimer = setTimeout(function () {
      toast.classList.remove('map-zoom-toast--visible');
    }, 3000);
  }

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
  }

  function updateMarkerPopup(current, locationName) {
    if (!markerInstance || !current) return;
    const name = locationName || 'Wetter';
    const temp = Math.round(current.temperature);
    const icon = current.description ? current.description.icon  : '';
    const desc = current.description ? current.description.label : '';

    var el       = document.createElement('div');
    var bold     = document.createElement('strong');
    var iconSpan = document.createElement('span');
    bold.textContent         = name;
    iconSpan.className       = 'popup-weather-icon';
    iconSpan.textContent     = icon;
    el.appendChild(bold);
    el.appendChild(document.createElement('br'));
    el.appendChild(iconSpan);
    el.appendChild(document.createTextNode(' ' + temp + '\u00B0C \u00B7 ' + desc));

    markerInstance.setPopupContent(el);
  }

  function initCloudLayer() {
    var btn = document.getElementById('map-cloud-btn');
    if (!btn || !mapInstance) return;

    var key = window.WD_CONFIG && window.WD_CONFIG.owmApiKey;
    if (!key) { btn.hidden = true; return; }

    var opacities = [1.0, 0.6, 0];
    var labels    = ['Wolken dimmen', 'Wolken ausblenden', 'Wolken einblenden'];
    var state     = 0;
    var tileUrl   = 'https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=' + key;

    var cloudLayer = L.tileLayer(tileUrl, {
      opacity:       opacities[state],
      maxZoom:       18,
      maxNativeZoom: 14,
      attribution:   'Wolken: <a href="https://openweathermap.org" target="_blank" rel="noopener noreferrer">OpenWeatherMap</a>'
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

  // 1×1 transparent GIF used to blank out invalid radar tiles.
  var TRANSPARENT_PX = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

  // How often to re-fetch weather-maps.json so the frame timestamp stays fresh.
  // RainViewer publishes new frames every 10 min; an older cached URL will
  // eventually serve "Zoom Level Not Supported" for every tile.
  var RADAR_REFRESH_MS = 5 * 60 * 1000;

  // URL of a sample tile used by the pre-flight check. Chosen in the centre of
  // RainViewer's European coverage (approx. 50°N, 10°E) at zoom 6 — tile
  // coordinates (33,21) in the standard XYZ scheme. If this tile already comes
  // back as an error image, the entire frame is stale/broken and the layer is
  // suppressed rather than shown as an unusable grey blanket.
  var SAMPLE_TILE_Z = 6;
  var SAMPLE_TILE_X = 33;
  var SAMPLE_TILE_Y = 21;

  // Heuristic used by both the per-tile sweep AND the pre-flight sample check.
  // RainViewer returns a PNG with "Zoom Level Not Supported" (HTTP 200) for
  // tiles outside its coverage — not just high-zoom tiles, also geographically
  // uncovered areas at any zoom. Signature: mostly-opaque grey (R≈G≈B),
  // zero saturated colour pixels. Real radar tiles are either fully transparent
  // (no precipitation) or contain saturated blue/green/yellow/red pixels.
  function _isRadarErrorTile(img) {
    try {
      if (!img || !img.complete || !img.naturalWidth) return false;
      var w = img.naturalWidth  || 256;
      var h = img.naturalHeight || 256;
      var canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.drawImage(img, 0, 0);
      var step = 8;                    // 32×32 = 1024 samples on a 256px tile
      var data = ctx.getImageData(0, 0, w, h).data;
      var visibleGrey  = 0;
      var saturated    = 0;
      var visibleTotal = 0;
      var total        = 0;
      for (var y = 0; y < h; y += step) {
        for (var x = 0; x < w; x += step) {
          var i = (y * w + x) * 4;
          var r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          total++;
          if (a < 20) continue;
          visibleTotal++;
          var maxc = Math.max(r, g, b);
          var minc = Math.min(r, g, b);
          if (maxc - minc <= 16)      visibleGrey++;
          else if (maxc - minc >= 40) saturated++;
        }
      }
      if (visibleTotal === 0) return false;   // fully transparent → fine
      if (saturated > 0)       return false;   // has real precip colour → fine
      var coverage  = visibleTotal / total;
      var greyRatio = visibleGrey / visibleTotal;
      return coverage >= 0.3 && greyRatio >= 0.7;
    } catch (e) {
      // Tainted canvas (CORS race) → we cannot verify; assume bad to blank out.
      if (window.console) console.warn('[WeatherMap] canvas tainted — possible CORS regression:', e);
      return true;
    }
  }

  // Pre-flight: download a known sample tile into an Image(), then run the
  // error-image heuristic on it. Resolves with `true` if the frame URL is
  // good, `false` if the sample already is an error image, and rejects on
  // network/decode failure. Uses a fresh query string so it bypasses any
  // stale cached entry.
  function _probeRadarTile(tileUrlTemplate) {
    return new Promise(function (resolve, reject) {
      var url = tileUrlTemplate
        .replace('{z}', String(SAMPLE_TILE_Z))
        .replace('{x}', String(SAMPLE_TILE_X))
        .replace('{y}', String(SAMPLE_TILE_Y))
        + '?_=' + Date.now();
      var img = new Image();
      img.crossOrigin = 'anonymous';
      var done = false;
      var timeout = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('radar probe timeout'));
      }, 6000);
      img.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        resolve(!_isRadarErrorTile(img));
      };
      img.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        reject(new Error('radar probe load failed'));
      };
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
    var currentHost    = null;

    function _disableLayer(reason) {
      // Called when RainViewer is clearly broken (bad probe, fetch fail).
      // Hide the button and remove any stale layer so the user doesn't see a
      // grey blanket of error tiles.
      if (radarLayer && mapInstance.hasLayer(radarLayer)) {
        mapInstance.removeLayer(radarLayer);
      }
      radarLayer = null;
      _overlayLayers.radar  = null;
      _overlayOpacity.radar = 0;
      btn.hidden = true;
      if (refreshTimerId) { clearInterval(refreshTimerId); refreshTimerId = null; }
    }

    function _buildTileUrl(host, path) {
      return host + path + '/256/{z}/{x}/{y}/2/1_1.png';
    }

    function _fetchFrameUrl() {
      // Fetches weather-maps.json and returns the newest frame's tile URL
      // template. Kept as its own function so we can reuse it from the
      // refresh timer.
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;
      return fetch('https://api.rainviewer.com/public/weather-maps.json',
                   controller ? { signal: controller.signal } : {})
        .then(function (r) {
          if (timer) clearTimeout(timer);
          if (!r.ok) throw new Error('RainViewer ' + r.status);
          return r.json();
        })
        .then(function (data) {
          var host = data.host;
          if (typeof host !== 'string' ||
              !/^https:\/\/tilecache\.rainviewer\.com/.test(host)) {
            throw new Error('unexpected RainViewer host: ' + host);
          }
          var frames = data.radar && data.radar.past;
          if (!frames || frames.length === 0) throw new Error('no radar data');
          currentHost = host;
          var latest = frames[frames.length - 1];
          return _buildTileUrl(host, latest.path);
        });
    }

    function _startOrRefresh(tileUrl, isInitial) {
      if (!radarLayer) {
        // First-time setup
        radarLayer = L.tileLayer(tileUrl, {
          opacity:       opacities[state],
          maxZoom:       18,
          maxNativeZoom: 7,             // RainViewer serves errors at zoom 8+; Leaflet
                                        // scales zoom-7 tiles up instead of requesting them.
          crossOrigin:   'anonymous',
          attribution:   'Radar: <a href="https://www.rainviewer.com" target="_blank" rel="noopener noreferrer">RainViewer</a>'
        });

        // Real HTTP errors — replace tile with transparent pixel.
        radarLayer.on('tileerror', function (ev) {
          if (ev.tile) ev.tile.src = TRANSPARENT_PX;
        });

        radarLayer.addTo(mapInstance);
        _overlayLayers.radar  = radarLayer;
        _overlayOpacity.radar = opacities[state];
        _syncLayerBtn(btn, state, labels);
      } else if (!isInitial) {
        // Refresh path — swap the URL so Leaflet requests the fresh frame.
        radarLayer.setUrl(tileUrl, false);
      }
    }

    function _loadFrame(isInitial) {
      return _fetchFrameUrl().then(function (tileUrl) {
        return _probeRadarTile(tileUrl).then(function (ok) {
          if (!ok) {
            // Frame is already an error image everywhere — don't show it.
            if (isInitial) _disableLayer('probe failed');
            // On refresh, keep the previous (still-working) layer rather than
            // swapping to a known-bad URL.
            return;
          }
          _startOrRefresh(tileUrl, isInitial);
        });
      });
    }

    _loadFrame(true).catch(function () {
      if (radarLayer) {
        // We already had a working layer; keep it. Only disable if nothing
        // was ever shown.
        return;
      }
      _disableLayer('initial fetch failed');
    });

    // Periodic refresh keeps the frame timestamp current so tiles don't go
    // stale after ~10 min of runtime. Guard clears any orphaned timer if
    // initRadarLayer() is ever called twice. Stops after 5 consecutive
    // failures to avoid runaway requests against a dead endpoint.
    if (refreshTimerId) { clearInterval(refreshTimerId); refreshTimerId = null; }
    var _refreshFailCount = 0;
    refreshTimerId = setInterval(function () {
      _loadFrame(false)
        .then(function () { _refreshFailCount = 0; })
        .catch(function () {
          if (++_refreshFailCount >= 5) {
            clearInterval(refreshTimerId);
            refreshTimerId = null;
          }
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
      setTimeout(function () {
        if (mapInstance) mapInstance.invalidateSize();
      }, 320);
    });
  }

  window.WeatherMap = {
    initMap:           initMap,
    initMapExpand:     initMapExpand,
    initCloudLayer:    initCloudLayer,
    initRadarLayer:    initRadarLayer,
    moveMarker:        moveMarker,
    updateMarkerPopup: updateMarkerPopup
  };
})();
