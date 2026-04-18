/* ==========================================================================
   ui.js — DOM rendering helpers
   ========================================================================== */

/* global window, document, Intl */

(function () {
  'use strict';

  const TZ     = 'Europe/Berlin';
  const LOCALE = 'de-DE';

  // ---------- Formatters ----------
  const hourFmt = new Intl.DateTimeFormat(LOCALE, {
    hour: '2-digit', minute: '2-digit', timeZone: TZ, hour12: false
  });
  const weekdayFmt = new Intl.DateTimeFormat(LOCALE, {
    weekday: 'short', timeZone: TZ
  });
  const dateShortFmt = new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit', month: '2-digit', timeZone: TZ
  });
  const dateLongFmt = new Intl.DateTimeFormat(LOCALE, {
    weekday: 'long', day: '2-digit', month: 'long', timeZone: TZ
  });
  const updatedFmt = new Intl.DateTimeFormat(LOCALE, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ, hour12: false
  });
  // Produces YYYY-MM-DD in Berlin local time — used for date comparisons.
  const berlinDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });

  // ---------- Utils ----------
  function round(n) {
    return (typeof n === 'number' && !isNaN(n)) ? String(Math.round(n)) : '--';
  }
  function fmtNum(n, digits) {
    if (typeof n !== 'number' || isNaN(n)) return '--';
    return n.toFixed(digits ?? 0).replace('.', ',');
  }
  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
  function removeSkeleton(el) {
    el.classList.remove('skeleton-text', 'skeleton-box');
  }
  function todayBerlin() {
    return berlinDateFmt.format(new Date());
  }

  // Holds the most recent full data object so the delegated click handler
  // on the daily grid always uses fresh API data without rebuilding listeners.
  let _lastData = null;

  // ---------- Hero ----------
  function renderHero(data) {
    const c     = data.current;
    const today = data.daily && data.daily[0] ? data.daily[0] : null;

    const heroIcon    = document.getElementById('hero-icon');
    const heroTemp    = document.getElementById('hero-temp');
    const heroDesc    = document.getElementById('hero-desc');
    const statFeels   = document.getElementById('stat-feels');
    const statHighLow = document.getElementById('stat-highlow');
    const statWind    = document.getElementById('stat-wind');
    const statHumidity= document.getElementById('stat-humidity');
    const statUv      = document.getElementById('stat-uv');
    const statPrecip  = document.getElementById('stat-precip');

    const heroTitle = document.getElementById('hero-title');
    if (heroTitle && data.location) {
      heroTitle.textContent = data.location.name + ', ' + data.location.country;
    }

    heroIcon.textContent = c.description.icon;
    heroTemp.textContent = round(c.temperature) + '\u00B0';
    heroDesc.textContent = c.description.label;

    statFeels.textContent    = round(c.apparent) + '\u00B0';
    statHighLow.textContent  = today
      ? round(today.tempMax) + '\u00B0 / ' + round(today.tempMin) + '\u00B0'
      : '--';
    statWind.textContent     = round(c.windSpeed) + ' km/h';
    statHumidity.textContent = round(c.humidity) + ' %';
    statUv.textContent       = fmtNum(c.uvIndex, 1);
    statPrecip.textContent   = fmtNum(c.precipitation, 1) + ' mm';

    [heroIcon, heroTemp, heroDesc, statFeels, statHighLow, statWind, statHumidity, statUv, statPrecip]
      .forEach(removeSkeleton);

    // Weather alert chip
    const alertEl = document.getElementById('weather-alert');
    if (alertEl) {
      const code = today ? today.weatherCode : c.weatherCode;
      let type, icon, text;
      if (code >= 95) {
        type = 'storm'; icon = '⛈️'; text = 'Gewitter heute';
      } else if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
        type = 'snow'; icon = '❄️'; text = 'Schnee heute';
      } else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
        type = 'rain'; icon = '🌧️'; text = 'Regen heute';
      } else {
        type = 'clear'; icon = '✅'; text = 'Kein Niederschlag heute';
      }
      alertEl.className = 'weather-alert ' + type;
      alertEl.textContent = icon + ' ' + text;
      alertEl.hidden = false;
    }
  }

  // ---------- Sun Card ----------
  function renderSun(data) {
    const today     = data.daily && data.daily[0] ? data.daily[0] : null;
    const sunRiseEl = document.getElementById('sun-rise');
    const sunSetEl  = document.getElementById('sun-set');
    const sunDurEl  = document.getElementById('sun-duration');
    const sunDateEl = document.getElementById('sun-date');
    const sunDot    = document.getElementById('sun-dot');

    if (!today || !today.sunrise || !today.sunset) {
      sunRiseEl.textContent = '--:--';
      sunSetEl.textContent  = '--:--';
      sunDurEl.textContent  = '--';
      return;
    }

    // sunrise/sunset are already proper Date objects (from unix timestamps).
    const rise = today.sunrise;
    const set  = today.sunset;
    const now  = new Date();

    sunRiseEl.textContent = hourFmt.format(rise);
    sunSetEl.textContent  = hourFmt.format(set);

    const durMs = set.getTime() - rise.getTime();
    const durH  = Math.floor(durMs / 3_600_000);
    const durM  = Math.floor((durMs % 3_600_000) / 60_000);
    sunDurEl.textContent = durH + ' h ' + (durM < 10 ? '0' : '') + durM + ' min';

    sunDateEl.textContent = dateLongFmt.format(rise);

    let progress = (now.getTime() - rise.getTime()) / durMs;
    if (progress < 0) progress = 0;
    if (progress > 1) progress = 1;

    const theta = Math.PI * (1 - progress);
    const cx    = 150 - 130 * Math.cos(theta);
    const cy    = 140 - 130 * Math.sin(theta);
    sunDot.setAttribute('cx', cx.toFixed(1));
    sunDot.setAttribute('cy', cy.toFixed(1));
    sunDot.setAttribute('fill', (progress <= 0 || progress >= 1) ? '#5b6178' : '#ffcc70');

    [sunRiseEl, sunSetEl, sunDurEl].forEach(removeSkeleton);
  }

  // ---------- Hourly Strip ----------
  function renderHourly(data) {
    const strip = document.getElementById('hourly-strip');

    if (!data.hourly || !data.hourly.length) {
      clearChildren(strip);
      strip.textContent = 'Keine stündlichen Daten verfügbar.';
      return;
    }

    const now = new Date();
    let startIdx = 0;
    for (let i = 0; i < data.hourly.length; i++) {
      if (data.hourly[i].time.getTime() >= now.getTime() - 30 * 60 * 1000) {
        startIdx = i;
        break;
      }
    }
    const slice = data.hourly.slice(startIdx, Math.min(startIdx + 24, data.hourly.length));

    // In-place update preserves scroll position on auto-refresh — only if items are fully rendered.
    const existing = Array.from(strip.querySelectorAll('.hourly-item'));
    const isRendered = existing.length > 0 && existing[0].querySelector('.hourly-time') !== null;
    if (isRendered && existing.length === slice.length) {
      slice.forEach(function (h, idx) {
        const item = existing[idx];
        item.querySelector('.hourly-time').textContent = idx === 0 ? 'Jetzt' : hourFmt.format(h.time);
        const iconEl = item.querySelector('.hourly-icon');
        iconEl.textContent = h.description.icon;
        iconEl.title       = h.description.label;
        item.querySelector('.hourly-temp').textContent   = round(h.temperature) + '\u00B0';
        const p = h.precipitationProbability;
        item.querySelector('.hourly-precip').textContent = '💧 ' + (typeof p === 'number' ? p : 0) + '%';
      });
      return;
    }

    // First render or count changed: full build via DocumentFragment.
    const frag = document.createDocumentFragment();
    slice.forEach(function (h, idx) {
      const item = document.createElement('div');
      item.className = 'hourly-item' + (idx === 0 ? ' now' : '');
      item.setAttribute('role', 'listitem');

      const timeLabel = document.createElement('span');
      timeLabel.className   = 'hourly-time';
      timeLabel.textContent = idx === 0 ? 'Jetzt' : hourFmt.format(h.time);

      const icon = document.createElement('span');
      icon.className   = 'hourly-icon';
      icon.textContent = h.description.icon;
      icon.title       = h.description.label;

      const temp = document.createElement('span');
      temp.className   = 'hourly-temp';
      temp.textContent = round(h.temperature) + '\u00B0';

      const precip = document.createElement('span');
      precip.className   = 'hourly-precip';
      const p = h.precipitationProbability;
      precip.textContent = '💧 ' + (typeof p === 'number' ? p : 0) + '%';
      precip.title       = 'Regenwahrscheinlichkeit';

      item.appendChild(timeLabel);
      item.appendChild(icon);
      item.appendChild(temp);
      item.appendChild(precip);
      frag.appendChild(item);
    });

    clearChildren(strip);
    strip.appendChild(frag);
  }

  // ---------- Daily Grid ----------
  function renderDaily(data) {
    _lastData = data;
    const grid = document.getElementById('daily-grid');

    if (!data.daily || !data.daily.length) {
      clearChildren(grid);
      grid.textContent = 'Keine Tagesdaten verfügbar.';
      return;
    }

    initDailyClickHandler();
    const todayStr = todayBerlin();

    // In-place update on refresh — only if items are already fully rendered (not skeletons).
    const existing = Array.from(grid.querySelectorAll('.daily-item'));
    const isRendered = existing.length > 0 && existing[0].querySelector('.daily-day') !== null;
    if (isRendered && existing.length === data.daily.length) {
      data.daily.forEach(function (d, idx) {
        const item      = existing[idx];
        const dateStr   = berlinDateFmt.format(d.date);
        const dayLabel  = dateStr === todayStr ? 'Heute' : (idx === 1 ? 'Morgen' : weekdayFmt.format(d.date));
        item.querySelector('.daily-day').textContent   = dayLabel;
        item.querySelector('.daily-date').textContent  = dateShortFmt.format(d.date);
        const iconEl = item.querySelector('.daily-icon');
        iconEl.textContent = d.description.icon;
        iconEl.title       = d.description.label;
        item.querySelector('.daily-desc').textContent  = d.description.label;
        item.querySelector('.temp-high').textContent   = round(d.tempMax) + '\u00B0';
        item.querySelector('.temp-low').textContent    = round(d.tempMin) + '\u00B0';
        item.querySelector('.daily-precip').textContent = '💧 ' + fmtNum(d.precipitationSum, 1) + ' mm';
      });
      // Refresh the detail panel if a day is currently selected.
      const selected = grid.querySelector('.daily-item.selected');
      if (selected) {
        const selIdx = parseInt(selected.dataset.dayIndex, 10);
        if (!isNaN(selIdx)) {
          const d        = data.daily[selIdx];
          const todStr   = todayBerlin();
          const dStr     = berlinDateFmt.format(d.date);
          const lbl      = dStr === todStr ? 'Heute' : (selIdx === 1 ? 'Morgen' : weekdayFmt.format(d.date));
          renderDayDetail(d, data.hourly.slice(selIdx * 24, (selIdx + 1) * 24), lbl);
        }
      }
      return;
    }

    // First render: full build via DocumentFragment.
    const frag = document.createDocumentFragment();
    data.daily.forEach(function (d, idx) {
      const item    = document.createElement('div');
      item.className = 'daily-item';
      item.dataset.dayIndex = String(idx);

      const dateStr  = berlinDateFmt.format(d.date);
      const dayLabel = dateStr === todayStr ? 'Heute' : (idx === 1 ? 'Morgen' : weekdayFmt.format(d.date));

      const day = document.createElement('span');
      day.className   = 'daily-day';
      day.textContent = dayLabel;

      const dateLabel = document.createElement('span');
      dateLabel.className   = 'daily-date';
      dateLabel.textContent = dateShortFmt.format(d.date);

      const icon = document.createElement('span');
      icon.className   = 'daily-icon';
      icon.textContent = d.description.icon;
      icon.title       = d.description.label;

      const desc = document.createElement('span');
      desc.className   = 'daily-desc';
      desc.textContent = d.description.label;

      const temps = document.createElement('div');
      temps.className = 'daily-temps';
      const high = document.createElement('span');
      high.className   = 'temp-high';
      high.textContent = round(d.tempMax) + '\u00B0';
      const low = document.createElement('span');
      low.className   = 'temp-low';
      low.textContent = round(d.tempMin) + '\u00B0';
      temps.appendChild(high);
      temps.appendChild(low);

      const precip = document.createElement('span');
      precip.className   = 'daily-precip';
      precip.textContent = '💧 ' + fmtNum(d.precipitationSum, 1) + ' mm';

      item.appendChild(day);
      item.appendChild(dateLabel);
      item.appendChild(icon);
      item.appendChild(desc);
      item.appendChild(temps);
      item.appendChild(precip);
      frag.appendChild(item);
    });

    clearChildren(grid);
    grid.appendChild(frag);
  }

  // ---------- Day Detail Panel ----------
  function renderDayDetail(day, hourlySlice, dayLabel) {
    const panel = document.getElementById('day-detail');
    if (!panel) return;

    const frag = document.createDocumentFragment();

    // Header: icon + title + description
    const header = document.createElement('div');
    header.className = 'day-detail-header';

    const iconEl = document.createElement('span');
    iconEl.className = 'day-detail-icon';
    iconEl.textContent = day.description.icon;

    const titleWrap = document.createElement('div');
    const titleEl = document.createElement('h3');
    titleEl.className = 'day-detail-title';
    titleEl.textContent = dayLabel + ' \u00B7 ' + dateShortFmt.format(day.date);
    const descEl = document.createElement('p');
    descEl.className = 'day-detail-desc';
    descEl.textContent = day.description.label;
    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(descEl);
    header.appendChild(iconEl);
    header.appendChild(titleWrap);
    frag.appendChild(header);

    // Stats grid
    const durMs = (day.sunrise && day.sunset) ? day.sunset.getTime() - day.sunrise.getTime() : 0;
    const durH  = Math.floor(durMs / 3_600_000);
    const durM  = Math.floor((durMs % 3_600_000) / 60_000);
    const stats = [
      { label: 'H\u00F6chst',      value: round(day.tempMax) + '\u00B0' },
      { label: 'Tiefst',           value: round(day.tempMin) + '\u00B0' },
      { label: 'Aufgang',          value: day.sunrise ? hourFmt.format(day.sunrise) : '--:--' },
      { label: 'Untergang',        value: day.sunset  ? hourFmt.format(day.sunset)  : '--:--' },
      { label: 'Tageslänge',       value: durMs ? durH + ' h ' + (durM < 10 ? '0' : '') + durM + ' min' : '--' },
      { label: 'UV-Index (max)',   value: fmtNum(day.uvIndexMax, 1) },
      { label: 'Niederschlag',     value: fmtNum(day.precipitationSum, 1) + ' mm' }
    ];

    const statsGrid = document.createElement('div');
    statsGrid.className = 'day-detail-stats';
    stats.forEach(function (s) {
      const statEl  = document.createElement('div');
      statEl.className = 'stat';
      const lblEl = document.createElement('span');
      lblEl.className   = 'stat-label';
      lblEl.textContent = s.label;
      const valEl = document.createElement('span');
      valEl.className   = 'stat-value';
      valEl.textContent = s.value;
      statEl.appendChild(lblEl);
      statEl.appendChild(valEl);
      statsGrid.appendChild(statEl);
    });
    frag.appendChild(statsGrid);

    // Hourly strip for the selected day
    if (hourlySlice && hourlySlice.length) {
      const hourlyLabel = document.createElement('div');
      hourlyLabel.className   = 'day-detail-hourly-label';
      hourlyLabel.textContent = 'Stündliche Übersicht';
      frag.appendChild(hourlyLabel);

      const strip = document.createElement('div');
      strip.className = 'hourly-strip';
      strip.setAttribute('role', 'list');

      hourlySlice.forEach(function (h) {
        const item = document.createElement('div');
        item.className = 'hourly-item';
        item.setAttribute('role', 'listitem');

        const timeEl = document.createElement('span');
        timeEl.className   = 'hourly-time';
        timeEl.textContent = hourFmt.format(h.time);

        const iconH = document.createElement('span');
        iconH.className   = 'hourly-icon';
        iconH.textContent = h.description.icon;
        iconH.title       = h.description.label;

        const tempEl = document.createElement('span');
        tempEl.className   = 'hourly-temp';
        tempEl.textContent = round(h.temperature) + '\u00B0';

        const precipEl = document.createElement('span');
        precipEl.className   = 'hourly-precip';
        const p = h.precipitationProbability;
        precipEl.textContent = '💧 ' + (typeof p === 'number' ? p : 0) + '%';
        precipEl.title       = 'Regenwahrscheinlichkeit';

        item.appendChild(timeEl);
        item.appendChild(iconH);
        item.appendChild(tempEl);
        item.appendChild(precipEl);
        strip.appendChild(item);
      });
      frag.appendChild(strip);
    }

    clearChildren(panel);
    panel.appendChild(frag);
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideDayDetail() {
    const panel = document.getElementById('day-detail');
    if (panel) panel.hidden = true;
  }

  function initDailyClickHandler() {
    const grid = document.getElementById('daily-grid');
    if (!grid || grid._detailHandlerAttached) return;
    grid._detailHandlerAttached = true;
    grid.addEventListener('click', function (e) {
      const item = e.target.closest('.daily-item');
      if (!item || !_lastData) return;
      const idx = parseInt(item.dataset.dayIndex, 10);
      if (isNaN(idx)) return;
      const wasSelected = item.classList.contains('selected');
      grid.querySelectorAll('.daily-item').forEach(function (el) { el.classList.remove('selected'); });
      if (wasSelected) {
        hideDayDetail();
      } else {
        item.classList.add('selected');
        const d          = _lastData.daily[idx];
        const todayStr   = todayBerlin();
        const dateStr    = berlinDateFmt.format(d.date);
        const dayLabel   = dateStr === todayStr ? 'Heute' : (idx === 1 ? 'Morgen' : weekdayFmt.format(d.date));
        const hourlySlice = _lastData.hourly.slice(idx * 24, (idx + 1) * 24);
        renderDayDetail(d, hourlySlice, dayLabel);
      }
    });
  }

  // ---------- Hourly View Toggle ----------
  function initHourlyToggle() {
    var btnTiles = document.getElementById('btn-tiles');
    var btnChart = document.getElementById('btn-chart');
    var strip    = document.getElementById('hourly-strip');
    var chart    = document.getElementById('hourly-chart');
    if (!btnTiles || !btnChart || !strip || !chart) return;

    function activate(showChart) {
      btnTiles.classList.toggle('active', !showChart);
      btnTiles.setAttribute('aria-pressed', String(!showChart));
      btnChart.classList.toggle('active', showChart);
      btnChart.setAttribute('aria-pressed', String(showChart));
      strip.hidden = showChart;
      chart.hidden = !showChart;
    }

    btnTiles.addEventListener('click', function () { activate(false); });
    btnChart.addEventListener('click', function () { activate(true); });
  }

  // ---------- Temperature Chart ----------
  function getHourlySlice(data) {
    if (!data.hourly || !data.hourly.length) return [];
    var now = new Date();
    var startIdx = 0;
    for (var i = 0; i < data.hourly.length; i++) {
      if (data.hourly[i].time.getTime() >= now.getTime() - 30 * 60 * 1000) {
        startIdx = i;
        break;
      }
    }
    return data.hourly.slice(startIdx, Math.min(startIdx + 24, data.hourly.length));
  }

  function renderTempChart(data) {
    var container = document.getElementById('hourly-chart');
    if (!container) return;

    var slice = getHourlySlice(data);
    if (slice.length < 2) {
      clearChildren(container);
      return;
    }

    var NS = 'http://www.w3.org/2000/svg';
    var W = 760, H = 200;
    var padL = 52, padR = 16, padT = 32, padB = 50;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var n = slice.length;

    var temps   = slice.map(function (h) { return h.temperature; });
    var tRawMin = Math.min.apply(null, temps);
    var tRawMax = Math.max.apply(null, temps);
    var tPad    = Math.max(2, (tRawMax - tRawMin) * 0.25);
    var tMin    = tRawMin - tPad;
    var tMax    = tRawMax + tPad;
    var tRange  = tMax - tMin || 1;

    function xOf(i) { return padL + (i / (n - 1)) * plotW; }
    function yOf(t) { return padT + (1 - (t - tMin) / tRange) * plotH; }

    var pts = slice.map(function (h, i) { return { x: xOf(i), y: yOf(h.temperature) }; });

    // Catmull-Rom → cubic Bézier for smooth curve
    function buildPath(points) {
      var d = 'M ' + points[0].x.toFixed(1) + ',' + points[0].y.toFixed(1);
      for (var i = 1; i < points.length; i++) {
        var p0  = points[Math.max(0, i - 2)];
        var p1  = points[i - 1];
        var p2  = points[i];
        var p3  = points[Math.min(points.length - 1, i + 1)];
        var cp1x = p1.x + (p2.x - p0.x) / 6;
        var cp1y = p1.y + (p2.y - p0.y) / 6;
        var cp2x = p2.x - (p3.x - p1.x) / 6;
        var cp2y = p2.y - (p3.y - p1.y) / 6;
        d += ' C ' + cp1x.toFixed(1) + ',' + cp1y.toFixed(1)
           + ' '   + cp2x.toFixed(1) + ',' + cp2y.toFixed(1)
           + ' '   + p2.x.toFixed(1) + ',' + p2.y.toFixed(1);
      }
      return d;
    }

    var linePath = buildPath(pts);
    var lastPt   = pts[pts.length - 1];
    var bottomY  = padT + plotH;
    var areaPath = linePath
      + ' L ' + lastPt.x.toFixed(1) + ',' + bottomY
      + ' L ' + pts[0].x.toFixed(1) + ',' + bottomY + ' Z';

    function svgEl(tag) { return document.createElementNS(NS, tag); }
    function setAttrs(elem, attrs) {
      Object.keys(attrs).forEach(function (k) { elem.setAttribute(k, attrs[k]); });
      return elem;
    }

    var svg = setAttrs(svgEl('svg'), {
      viewBox: '0 0 ' + W + ' ' + H,
      'class': 'temp-chart-svg',
      'aria-hidden': 'true'
    });

    // Gradient defs
    var defs    = svgEl('defs');
    var lineGrd = setAttrs(svgEl('linearGradient'), { id: 'tcLine', x1: '0', x2: '1', y1: '0', y2: '0' });
    lineGrd.appendChild(setAttrs(svgEl('stop'), { offset: '0%',   'stop-color': '#38bdf8' }));
    lineGrd.appendChild(setAttrs(svgEl('stop'), { offset: '100%', 'stop-color': '#2dd4bf' }));
    var areaGrd = setAttrs(svgEl('linearGradient'), { id: 'tcArea', x1: '0', x2: '0', y1: '0', y2: '1' });
    areaGrd.appendChild(setAttrs(svgEl('stop'), { offset: '0%',   'stop-color': '#38bdf8', 'stop-opacity': '0.22' }));
    areaGrd.appendChild(setAttrs(svgEl('stop'), { offset: '100%', 'stop-color': '#38bdf8', 'stop-opacity': '0.02' }));
    defs.appendChild(lineGrd);
    defs.appendChild(areaGrd);
    svg.appendChild(defs);

    // Horizontal grid lines
    var gridStep  = Math.max(1, Math.ceil((tRawMax - tRawMin + 4) / 4));
    var gridStart = Math.floor(tMin / gridStep) * gridStep;
    for (var gt = gridStart; gt <= tMax + 0.5; gt += gridStep) {
      if (gt < tMin - 0.5 || gt > tMax + 0.5) continue;
      var gy = yOf(gt);
      svg.appendChild(setAttrs(svgEl('line'), {
        x1: padL, x2: W - padR, y1: gy, y2: gy,
        stroke: '#252a40', 'stroke-width': '1'
      }));
      var yLbl = setAttrs(svgEl('text'), {
        x: padL - 20, y: gy + 4,
        'text-anchor': 'end', fill: '#5b6178', 'font-size': '11'
      });
      yLbl.textContent = Math.round(gt) + '\u00B0';
      svg.appendChild(yLbl);
    }

    // Area fill
    svg.appendChild(setAttrs(svgEl('path'), { d: areaPath, fill: 'url(#tcArea)' }));

    // Precipitation bars
    var barAreaH = 14;
    var barAreaY = H - padB + 20;
    var barW     = Math.max(2, (plotW / n) - 2);
    slice.forEach(function (h, i) {
      var p = h.precipitationProbability || 0;
      if (p < 5) return;
      var bh = (p / 100) * barAreaH;
      var bx = padL + (i / n) * plotW;
      svg.appendChild(setAttrs(svgEl('rect'), {
        x: bx.toFixed(1), y: (barAreaY + barAreaH - bh).toFixed(1),
        width: barW.toFixed(1), height: bh.toFixed(1),
        fill: 'rgba(56,189,248,0.28)', rx: '2'
      }));
    });

    // Smooth line
    svg.appendChild(setAttrs(svgEl('path'), {
      d: linePath, fill: 'none',
      stroke: 'url(#tcLine)', 'stroke-width': '2.5',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }));

    // Dots + labels every 3 h
    slice.forEach(function (h, i) {
      var px = pts[i].x, py = pts[i].y;
      var isNow     = i === 0;
      var showLabel = isNow || i % 3 === 0;

      svg.appendChild(setAttrs(svgEl('circle'), {
        cx: px.toFixed(1), cy: py.toFixed(1), r: showLabel ? '4' : '2.5',
        fill: isNow ? '#38bdf8' : '#2dd4bf',
        stroke: '#1a1d2e', 'stroke-width': '2'
      }));

      if (showLabel) {
        var tLbl = setAttrs(svgEl('text'), {
          x: px.toFixed(1), y: (py - 12).toFixed(1),
          'text-anchor': 'middle', fill: '#e6e9f2',
          'font-size': '10', 'font-weight': '600'
        });
        tLbl.textContent = Math.round(h.temperature) + '\u00B0';
        svg.appendChild(tLbl);

        var timeLbl = setAttrs(svgEl('text'), {
          x: px.toFixed(1), y: (barAreaY - 4).toFixed(1),
          'text-anchor': 'middle',
          fill: isNow ? '#38bdf8' : '#8892b0',
          'font-size': '11',
          'font-weight': isNow ? '600' : '400'
        });
        timeLbl.textContent = isNow ? 'Jetzt' : hourFmt.format(h.time);
        svg.appendChild(timeLbl);
      }
    });

    clearChildren(container);
    container.appendChild(svg);
  }

  // ---------- Alerts ----------
  var SEVERITY_META = {
    minor:    { label: 'Gering',  icon: '⚠️',  cls: 'severity-minor'    },
    moderate: { label: 'Mäßig',  icon: '🌩️', cls: 'severity-moderate' },
    severe:   { label: 'Schwer', icon: '⛈️',  cls: 'severity-severe'   },
    extreme:  { label: 'Extrem', icon: '🚨',  cls: 'severity-extreme'  }
  };

  var SEVERITY_ORDER = { minor: 0, moderate: 1, severe: 2, extreme: 3 };

  function renderAlerts(alerts) {
    var section = document.getElementById('alerts-section');
    var listEl  = document.getElementById('alerts-list');
    var countEl = document.getElementById('alerts-count');
    var alertEl = document.getElementById('weather-alert');

    if (!section || !listEl) return;

    if (!alerts || !alerts.length) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    if (countEl) {
      countEl.textContent = alerts.length + ' aktiv';
    }

    // Override hero pill with highest-severity DWD alert state
    if (alertEl) {
      var highest = alerts.reduce(function (acc, a) {
        return (SEVERITY_ORDER[a.severity] || 0) > (SEVERITY_ORDER[acc.severity] || 0) ? a : acc;
      }, alerts[0]);
      var pillMeta = SEVERITY_META[highest.severity] || SEVERITY_META.minor;
      alertEl.className = 'weather-alert dwd-' + highest.severity;
      alertEl.textContent = pillMeta.icon + ' ' + alerts.length
        + ' DWD-Warnung' + (alerts.length > 1 ? 'en' : '') + ' aktiv';
      alertEl.hidden = false;
    }

    var frag = document.createDocumentFragment();
    alerts.forEach(function (a) {
      var meta = SEVERITY_META[a.severity] || SEVERITY_META.minor;

      var item = document.createElement('div');
      item.className = 'alert-item ' + meta.cls;

      var bar = document.createElement('div');
      bar.className = 'alert-bar';

      var body = document.createElement('div');
      body.className = 'alert-body';

      // Header row: icon + title + badge
      var head = document.createElement('div');
      head.className = 'alert-head';

      var iconEl = document.createElement('span');
      iconEl.className = 'alert-icon';
      iconEl.setAttribute('aria-hidden', 'true');
      iconEl.textContent = meta.icon;

      var titleEl = document.createElement('span');
      titleEl.className = 'alert-title';
      titleEl.textContent = a.headline || a.event || 'Unwetterwarnung';

      var badge = document.createElement('span');
      badge.className = 'alert-badge';
      badge.textContent = meta.label;

      head.appendChild(iconEl);
      head.appendChild(titleEl);
      head.appendChild(badge);

      // Time row
      var timeEl = document.createElement('div');
      timeEl.className = 'alert-time';
      if (a.onset && a.expires) {
        var onsetDate   = berlinDateFmt.format(a.onset);
        var expiresDate = berlinDateFmt.format(a.expires);
        if (onsetDate === expiresDate) {
          timeEl.textContent = 'Gültig ' + hourFmt.format(a.onset)
            + ' – ' + hourFmt.format(a.expires) + ' Uhr';
        } else {
          timeEl.textContent = 'Von ' + dateShortFmt.format(a.onset) + ' '
            + hourFmt.format(a.onset) + ' bis ' + dateShortFmt.format(a.expires)
            + ' ' + hourFmt.format(a.expires) + ' Uhr';
        }
      } else if (a.expires) {
        timeEl.textContent = 'Bis ' + hourFmt.format(a.expires) + ' Uhr';
      }

      body.appendChild(head);
      body.appendChild(timeEl);

      // Description + tap-to-expand
      if (a.description) {
        var desc = document.createElement('p');
        desc.className = 'alert-desc';
        desc.textContent = a.description;
        body.appendChild(desc);
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-expanded', 'false');
        item.addEventListener('click', function () {
          var expanded = item.classList.toggle('expanded');
          item.setAttribute('aria-expanded', String(expanded));
        });
        item.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.click();
          }
        });
      }

      item.appendChild(bar);
      item.appendChild(body);
      frag.appendChild(item);
    });

    clearChildren(listEl);
    listEl.appendChild(frag);
  }

  // ---------- Header / status ----------
  function renderUpdatedAt(date) {
    const el = document.getElementById('last-updated');
    if (!el) return;
    el.textContent = 'Aktualisiert: ' + updatedFmt.format(date) + ' Uhr';
  }

  // ---------- Error banner ----------
  function showError(message) {
    const banner = document.getElementById('error-banner');
    const msg    = document.getElementById('error-message');
    if (!banner) return;
    msg.textContent  = message || 'Bitte versuche es erneut.';
    banner.hidden    = false;
  }
  function hideError() {
    const banner = document.getElementById('error-banner');
    if (banner) banner.hidden = true;
  }

  // ---------- Refresh button state ----------
  function setRefreshing(isRefreshing) {
    const btn = document.getElementById('refresh-btn');
    if (!btn) return;
    btn.classList.toggle('loading', isRefreshing);
    btn.disabled = isRefreshing;
  }

  window.WeatherUI = {
    renderHero:        renderHero,
    renderSun:         renderSun,
    renderHourly:      renderHourly,
    renderTempChart:   renderTempChart,
    initHourlyToggle:  initHourlyToggle,
    renderDaily:       renderDaily,
    renderDayDetail:   renderDayDetail,
    hideDayDetail:     hideDayDetail,
    renderAlerts:      renderAlerts,
    renderUpdatedAt:   renderUpdatedAt,
    showError:         showError,
    hideError:         hideError,
    setRefreshing:     setRefreshing
  };
})();
