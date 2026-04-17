/* ==========================================================================
   map.js — Leaflet map initialisation
   ========================================================================== */

/* global L, window */

(function () {
  'use strict';

  let mapInstance    = null;
  let markerInstance = null;

  function initMap(opts) {
    if (mapInstance) return mapInstance;

    const options  = opts || {};
    const nuremberg = [options.lat || 49.45, options.lon || 11.08];

    mapInstance = L.map('map', {
      center:           [51.2, 10.4],
      zoom:             6,
      minZoom:          4,
      maxZoom:          14,
      zoomControl:      true,
      attributionControl: true,
      scrollWheelZoom:  false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(mapInstance);

    const weatherIcon = L.divIcon({
      html:       '<div class="weather-marker">⛅</div>',
      iconSize:   [40, 40],
      iconAnchor: [20, 20],
      popupAnchor:[0, -20]
    });

    markerInstance = L.marker(nuremberg, { icon: weatherIcon }).addTo(mapInstance);

    // Accessible tooltip (Leaflet-native, not a title attr on an inner div).
    markerInstance.bindTooltip('Nürnberg', { permanent: false, direction: 'top' });

    // Initial popup built from DOM nodes — no HTML string concatenation.
    markerInstance.bindPopup(_buildPopupEl('Nürnberg', 'Bayern, Deutschland', '49.45° N, 11.08° E'));

    // Scroll-zoom: enable on container mouseenter, disable on mouseleave.
    // Using the container element's events avoids Leaflet's mouseout firing
    // on child layers (markers, popups) which would kill zoom mid-gesture.
    const container = mapInstance.getContainer();
    container.addEventListener('mouseenter', function () {
      mapInstance.scrollWheelZoom.enable();
    });
    container.addEventListener('mouseleave', function () {
      mapInstance.scrollWheelZoom.disable();
    });

    // ResizeObserver replaces the racy setTimeout — fires once the container
    // has a real size, no matter how long layout takes.
    if (typeof ResizeObserver !== 'undefined') {
      var resizeObserver = new ResizeObserver(function (entries) {
        if (entries[0].contentRect.width > 0) {
          mapInstance.invalidateSize();
          resizeObserver.disconnect();
        }
      });
      resizeObserver.observe(container);
    } else {
      // Fallback for very old browsers.
      setTimeout(function () { if (mapInstance) mapInstance.invalidateSize(); }, 300);
    }

    return mapInstance;
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

  function updateMarkerPopup(current) {
    if (!markerInstance || !current) return;
    const temp = Math.round(current.temperature);
    const icon = current.description ? current.description.icon  : '';
    const desc = current.description ? current.description.label : '';

    var el   = document.createElement('div');
    var bold = document.createElement('strong');
    bold.textContent = 'Nürnberg';
    var iconSpan = document.createElement('span');
    iconSpan.style.fontSize = '1.2rem';
    iconSpan.textContent    = icon;
    el.appendChild(bold);
    el.appendChild(document.createElement('br'));
    el.appendChild(iconSpan);
    el.appendChild(document.createTextNode(' ' + temp + '°C · ' + desc));

    markerInstance.setPopupContent(el);
  }

  window.WeatherMap = {
    initMap:           initMap,
    updateMarkerPopup: updateMarkerPopup
  };
})();
