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

    // Scroll-zoom: enable on container mouseenter, disable on mouseleave.
    const container = mapInstance.getContainer();
    container.addEventListener('mouseenter', function () {
      mapInstance.scrollWheelZoom.enable();
    });
    container.addEventListener('mouseleave', function () {
      mapInstance.scrollWheelZoom.disable();
    });

    // Show toast when zoomed past overlay tile resolution and at least one
    // overlay is visible.
    mapInstance.on('zoomend', function () {
      if (mapInstance.getZoom() >= 14 &&
          (_overlayOpacity.cloud > 0 || _overlayOpacity.radar > 0)) {
        _showZoomToast(container.parentElement);
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
      toast.textContent = 'Overlay-Daten bei dieser Zoomstufe nicht verfügbar';
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

  // Heuristic: RainViewer returns a PNG with the text "Zoom Level Not Supported"
  // (HTTP 200) for tiles outside its coverage — i.e. not just high-zoom tiles,
  // but also geographically uncovered areas at any zoom. The image has a
  // characteristic signature: lots of opaque, near-grayscale pixels (white/grey
  // text on a semi-transparent grey background). Real radar tiles are either
  // fully transparent (no precipitation) or contain saturated colour pixels
  // (blue/green/yellow/red). We sample a coarse grid and flag a tile as
  // "error-like" when a high fraction of pixels are opaque and desaturated.
  function _isRadarErrorTile(img) {
    try {
      var canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth  || 256;
      canvas.height = img.naturalHeight || 256;
      var ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.drawImage(img, 0, 0);
      var step = 16;                   // 16×16 = 256 samples across a 256px tile
      var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      var greyOpaque = 0;
      var saturated  = 0;
      var total      = 0;
      for (var y = 0; y < canvas.height; y += step) {
        for (var x = 0; x < canvas.width; x += step) {
          var i = (y * canvas.width + x) * 4;
          var r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          total++;
          if (a < 200) continue;        // transparent or near-transparent
          var maxc = Math.max(r, g, b);
          var minc = Math.min(r, g, b);
          if (maxc - minc <= 12) {      // R≈G≈B → grayscale pixel (text/bg)
            greyOpaque++;
          } else if (maxc - minc >= 40) {
            saturated++;                // coloured radar return
          }
        }
      }
      // Error image has grey content and no coloured radar returns.
      // Real tiles are either fully transparent (greyOpaque=0) or have saturated colour.
      return greyOpaque >= 6 && saturated === 0;
    } catch (e) {
      return false;                     // tainted canvas etc. → keep tile
    }
  }

  function initRadarLayer() {
    var btn = document.getElementById('map-radar-btn');
    if (!btn || !mapInstance) return;

    var radarLayer = null;
    var opacities  = [0.7, 0.3, 0];
    var labels     = ['Niederschlag dimmen', 'Niederschlag ausblenden', 'Niederschlag einblenden'];
    var state      = 0;

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer      = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;

    fetch('https://api.rainviewer.com/public/weather-maps.json',
          controller ? { signal: controller.signal } : {})
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error('RainViewer ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var frames = data.radar && data.radar.past;
        if (!frames || frames.length === 0) throw new Error('no radar data');
        var latest  = frames[frames.length - 1];
        var tileUrl = data.host + latest.path + '/256/{z}/{x}/{y}/2/1_1.png';

        radarLayer = L.tileLayer(tileUrl, {
          opacity:       opacities[state],
          maxZoom:       18,
          maxNativeZoom: 14,
          crossOrigin:   true,          // required for canvas pixel read
          attribution:   'Radar: <a href="https://www.rainviewer.com" target="_blank" rel="noopener noreferrer">RainViewer</a>'
        });

        // Real HTTP errors (rare — RainViewer usually returns 200 with an
        // embedded "Zoom Level Not Supported" image instead).
        radarLayer.on('tileerror', function (ev) {
          if (ev.tile) ev.tile.src = TRANSPARENT_PX;
        });

        // HTTP-200 error-image detection: once a tile finishes loading, sample
        // its pixels. If it's the "Zoom Level Not Supported" bitmap, swap in a
        // transparent pixel so nothing is drawn for that cell.
        radarLayer.on('tileload', function (ev) {
          var img = ev.tile;
          if (!img || img.src.indexOf('data:') === 0) return;
          if (_isRadarErrorTile(img)) img.src = TRANSPARENT_PX;
        });

        radarLayer.addTo(mapInstance);
        _overlayOpacity.radar = opacities[state];
        _syncLayerBtn(btn, state, labels);
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        btn.hidden = true;
      });

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
