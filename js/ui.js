/* ==========================================================================
   ui.js — DOM rendering helpers
   ========================================================================== */

/* global window, document, Intl */

(function () {
  'use strict';

  let _tz      = 'Europe/Berlin';
  const LOCALE = 'de-DE';

  // ---------- Formatters ----------
  // These are rebuilt by setTimezone() whenever the active location changes.
  let hourFmt, weekdayFmt, dateShortFmt, dateLongFmt, updatedFmt, localDateFmt;

  // Wraps Intl.DateTimeFormat construction; on RangeError (invalid timezone)
  // falls back to Europe/Berlin so a corrupt tz string never crashes rendering.
  function _safeDtf(locale, options) {
    try {
      return new Intl.DateTimeFormat(locale, options);
    } catch (e) {
      var safe = Object.assign({}, options, { timeZone: 'Europe/Berlin' });
      return new Intl.DateTimeFormat(locale, safe);
    }
  }

  function _buildFormatters() {
    hourFmt      = _safeDtf(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: _tz, hour12: false });
    weekdayFmt   = _safeDtf(LOCALE, { weekday: 'short', timeZone: _tz });
    dateShortFmt = _safeDtf(LOCALE, { day: '2-digit', month: '2-digit', timeZone: _tz });
    dateLongFmt  = _safeDtf(LOCALE, { weekday: 'long', day: '2-digit', month: 'long', timeZone: _tz });
    updatedFmt   = _safeDtf(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: _tz, hour12: false });
    // Produces YYYY-MM-DD in local time — used for "is today" date comparisons.
    localDateFmt = _safeDtf('en-CA', { timeZone: _tz });
  }

  _buildFormatters();

  function setTimezone(tz) {
    _tz = String(tz || 'Europe/Berlin').slice(0, 50);
    _buildFormatters();
  }

  // ---------- SVG helpers (shared by renderTempChart + renderAqiChart) ----------
  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag) { return document.createElementNS(NS, tag); }
  function setAttrs(elem, attrs) {
    Object.keys(attrs).forEach(function (k) { elem.setAttribute(k, attrs[k]); });
    return elem;
  }

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
  function todayLocal() {
    return localDateFmt.format(new Date());
  }

  // Holds the most recent full data object so the delegated click handler
  // on the daily grid always uses fresh API data without rebuilding listeners.
  let _lastData = null;

  // Currently active hourly timestamp (ms) for radar frame scrubbing; null = live.
  let _activeHourTs = null;

  // AQI color/label lookup lives on window.WeatherAPI (see weather.js) so the
  // same table is used here and in map.js without drift.

  // ---------- Wind / UV helpers ----------
  const _WIND_ARROWS  = ['↓','↙','←','↖','↑','↗','→','↘'];
  const _WIND_COMPASS = ['N','NO','O','SO','S','SW','W','NW'];

  function windDirArrow(deg) {
    if (typeof deg !== 'number' || isNaN(deg)) return { arrow: '', compass: '' };
    var idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
    return { arrow: _WIND_ARROWS[idx], compass: _WIND_COMPASS[idx] };
  }

  function beaufort(kmh) {
    if (typeof kmh !== 'number' || isNaN(kmh)) return null;
    return kmh < 1 ? 0 : kmh < 6 ? 1 : kmh < 12 ? 2 : kmh < 20 ? 3 :
           kmh < 29 ? 4 : kmh < 39 ? 5 : kmh < 50 ? 6 : kmh < 62 ? 7 :
           kmh < 75 ? 8 : kmh < 89 ? 9 : kmh < 103 ? 10 : kmh < 118 ? 11 : 12;
  }

  function uvRisk(idx) {
    if (typeof idx !== 'number' || isNaN(idx)) return '';
    if (idx < 3)  return 'Niedrig';
    if (idx < 6)  return 'Mittel';
    if (idx < 8)  return 'Hoch';
    if (idx < 11) return 'Sehr hoch';
    return 'Extrem';
  }

  // ---------- Rain timing helper ----------
  const PRECIP_THRESHOLD = 40; // % probability minimum
  function isPrecipCode(code) {
    return (code >= 51 && code <= 67) ||
           (code >= 71 && code <= 86) ||
           code >= 95;
  }
  function precipType(code) {
    if (code >= 95) return 'storm';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    return 'rain';
  }

  /**
   * Scans hourly data within the next 12 h and returns timing info.
   * Returns null if no precipitation is expected.
   * Returns { isNow: bool, endsInMs: number|null, startsInMs: number, type: string }
   */
  function findPrecipTiming(hourly, currentCode, currentPrecipMm) {
    if (!hourly || !hourly.length) return null;
    const now        = Date.now();
    const windowEnd  = now + 12 * 3_600_000;

    // Only look at entries within the next 12 h (plus the current bucket which may be <= now)
    const relevant = hourly.filter(function (h) {
      return h.time.getTime() >= now - 3_600_000 && h.time.getTime() < windowEnd;
    });
    if (!relevant.length) return null;

    // Is it currently precipitating?
    // currentPrecipMm is the measured mm in the last hour — if 0 the forecast code is stale.
    const measuredRaining = typeof currentPrecipMm === 'number' ? currentPrecipMm >= 0.1 : true;
    const currentlyPrecip = isPrecipCode(currentCode) && measuredRaining;

    if (currentlyPrecip) {
      // Find how long it keeps going (first future bucket that drops below threshold)
      const type = precipType(currentCode);
      let endBucket = null;
      for (const h of relevant) {
        const prob    = typeof h.precipitationProbability === 'number' ? h.precipitationProbability : 0;
        const hasCode = isPrecipCode(h.weatherCode);
        if (!hasCode && prob < PRECIP_THRESHOLD) { endBucket = h; break; }
      }
      const endsInMs = endBucket ? endBucket.time.getTime() - now : null;
      return { isNow: true, endsInMs: endsInMs, startsInMs: 0, type: type };
    }

    // Not currently raining — find when it starts.
    // When probability data is available, use it as the primary gate (prob >= threshold).
    // Only fall back to WMO code if probability is missing from the response.
    for (const h of relevant) {
      if (h.time.getTime() < now) continue; // skip current (already checked above)
      const probAvailable = typeof h.precipitationProbability === 'number';
      const prob          = probAvailable ? h.precipitationProbability : 0;
      const hasCode       = isPrecipCode(h.weatherCode);
      const passes        = probAvailable ? prob >= PRECIP_THRESHOLD : hasCode;
      if (passes) {
        const type = hasCode ? precipType(h.weatherCode) : 'rain';
        return { isNow: false, endsInMs: null, startsInMs: h.time.getTime() - now, type: type };
      }
    }
    return null;
  }

  function formatDuration(ms) {
    const mins  = Math.round(ms / 60_000);
    const hours = Math.round(ms / 3_600_000);
    if (mins < 60) return mins + ' Min.';
    return hours + ' Std.';
  }

  // ---------- Shared helpers ----------
  function _renderAlertChip(alertEl, code, suffix) {
    if (!alertEl) return;
    var type, icon, text;
    if (code >= 95)                                                     { type = 'storm'; icon = '⛈️'; text = 'Gewitter'; }
    else if ((code >= 71 && code <= 77) || code === 85 || code === 86) { type = 'snow';  icon = '❄️'; text = 'Schnee'; }
    else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) { type = 'rain';  icon = '🌧️'; text = 'Regen'; }
    else                                                                { type = 'clear'; icon = '✅'; text = 'Kein Niederschlag'; }
    alertEl.className   = 'weather-alert ' + type;
    alertEl.textContent = icon + ' ' + text + suffix;
    alertEl.hidden      = false;
  }

  function _buildHourlyItem(h, opts) {
    var o    = opts || {};
    var item = document.createElement('div');
    item.className = 'hourly-item' + (o.isFirst ? ' now' : '') + (o.isActive ? ' radar-active' : '');
    item.setAttribute('role', 'listitem');
    if (o.showDataTs) item.dataset.hourTs = String(h.time.getTime());

    var timeLabel       = document.createElement('span');
    timeLabel.className   = 'hourly-time';
    timeLabel.textContent = o.isFirst ? 'Jetzt' : hourFmt.format(h.time);

    var icon         = document.createElement('span');
    icon.className   = 'hourly-icon';
    icon.textContent = h.description.icon;
    icon.title       = h.description.label;

    var temp         = document.createElement('span');
    temp.className   = 'hourly-temp';
    temp.textContent = round(h.temperature) + '\u00B0';

    var precip         = document.createElement('span');
    precip.className   = 'hourly-precip';
    var p = h.precipitationProbability;
    precip.textContent = '💧 ' + (typeof p === 'number' ? p : 0) + '%';
    precip.title       = 'Regenwahrscheinlichkeit';

    item.appendChild(timeLabel);
    item.appendChild(icon);
    item.appendChild(temp);
    item.appendChild(precip);
    return item;
  }

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
    const wd  = windDirArrow(c.windDirection);
    const bft = beaufort(c.windSpeed);
    statWind.textContent = (wd.arrow ? wd.arrow + '\u00A0' : '') + round(c.windSpeed) + ' km/h';
    const windMeta = document.getElementById('stat-wind-meta');
    if (windMeta) windMeta.textContent = bft !== null ? 'Bft\u00A0' + bft + (wd.compass ? '\u00A0\u00B7\u00A0' + wd.compass : '') : '';
    statHumidity.textContent = round(c.humidity) + ' %';
    statUv.textContent       = fmtNum(c.uvIndex, 1);
    const uvMeta = document.getElementById('stat-uv-meta');
    if (uvMeta) uvMeta.textContent = uvRisk(c.uvIndex);
    statPrecip.textContent   = fmtNum(c.precipitation, 1) + ' mm';

    [heroIcon, heroTemp, heroDesc, statFeels, statHighLow, statWind, statHumidity, statUv, statPrecip]
      .forEach(removeSkeleton);

    // Weather alert chip
    _renderAlertChip(
      document.getElementById('weather-alert'),
      today ? today.weatherCode : c.weatherCode,
      ' heute'
    );

    // Rain timing chip
    const timingEl = document.getElementById('rain-timing');
    if (timingEl) {
      const timing = findPrecipTiming(data.hourly, c.weatherCode, c.precipitation);
      if (!timing) {
        timingEl.hidden = true;
      } else {
        const typeIcons = { rain: '🌧️', snow: '❄️', storm: '⛈️' };
        const icon = typeIcons[timing.type] || '🌧️';
        let text;
        if (timing.isNow) {
          if (timing.endsInMs !== null && timing.endsInMs > 0) {
            text = icon + ' noch ~' + formatDuration(timing.endsInMs);
          } else {
            timingEl.hidden = true;
            return;
          }
        } else {
          text = '🕐 in ~' + formatDuration(timing.startsInMs);
        }
        timingEl.className = 'weather-alert rain-timing ' + timing.type;
        timingEl.textContent = text;
        timingEl.hidden = false;
      }
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

    const slice = getHourlySlice(data);

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
        item.dataset.hourTs = String(h.time.getTime());
        item.classList.toggle('radar-active', h.time.getTime() === _activeHourTs);
      });
      return;
    }

    // First render or count changed: full build via DocumentFragment.
    const frag = document.createDocumentFragment();
    slice.forEach(function (h, idx) {
      frag.appendChild(_buildHourlyItem(h, {
        isFirst:    idx === 0,
        isActive:   h.time.getTime() === _activeHourTs,
        showDataTs: true
      }));
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
    const todayStr = todayLocal();

    // In-place update on refresh — only if items are already fully rendered (not skeletons).
    const existing = Array.from(grid.querySelectorAll('.daily-item'));
    const isRendered = existing.length > 0 && existing[0].querySelector('.daily-day') !== null;
    if (isRendered && existing.length === data.daily.length) {
      data.daily.forEach(function (d, idx) {
        const item      = existing[idx];
        const dateStr   = localDateFmt.format(d.date);
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
          const todStr   = todayLocal();
          const dStr     = localDateFmt.format(d.date);
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

      const dateStr  = localDateFmt.format(d.date);
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
        strip.appendChild(_buildHourlyItem(h, {}));
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
        const todayStr   = todayLocal();
        const dateStr    = localDateFmt.format(d.date);
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
      if (data.hourly[i].time.getTime() >= now.getTime() - 30 * 60 * 1000) { startIdx = i; break; }
    }
    return data.hourly.slice(startIdx, Math.min(startIdx + 24, data.hourly.length));
  }

  function renderTempChart(data) {
    var container = document.getElementById('hourly-chart');
    if (!container) return;

    var slice = getHourlySlice(data);
    if (slice.length < 2) { clearChildren(container); return; }

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

    var barAreaY = H - padB + 20; // y-position of time labels at the bottom

    function xOf(i) { return padL + (i / (n - 1)) * plotW; }
    function yOf(t) { return padT + (1 - (t - tMin) / tRange) * plotH; }

    var pts = slice.map(function (h, i) { return { x: xOf(i), y: yOf(h.temperature) }; });

    function buildPath(points) {
      var d = 'M ' + points[0].x.toFixed(1) + ',' + points[0].y.toFixed(1);
      for (var i = 1; i < points.length; i++) {
        var p0 = points[Math.max(0, i-2)], p1 = points[i-1];
        var p2 = points[i], p3 = points[Math.min(points.length-1, i+1)];
        var cp1x = p1.x + (p2.x - p0.x) / 6, cp1y = p1.y + (p2.y - p0.y) / 6;
        var cp2x = p2.x - (p3.x - p1.x) / 6, cp2y = p2.y - (p3.y - p1.y) / 6;
        d += ' C ' + cp1x.toFixed(1) + ',' + cp1y.toFixed(1)
           + ' '   + cp2x.toFixed(1) + ',' + cp2y.toFixed(1)
           + ' '   + p2.x.toFixed(1) + ',' + p2.y.toFixed(1);
      }
      return d;
    }

    var linePath = buildPath(pts);
    var lastPt   = pts[pts.length - 1];
    var bottomY  = padT + plotH;
    var areaPath = linePath + ' L ' + lastPt.x.toFixed(1) + ',' + bottomY
                            + ' L ' + pts[0].x.toFixed(1) + ',' + bottomY + ' Z';

    var svg = setAttrs(svgEl('svg'), {
      viewBox: '0 0 ' + W + ' ' + H,
      'class': 'temp-chart-svg',
      'aria-hidden': 'true',
      style: 'cursor:pointer'
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
      svg.appendChild(setAttrs(svgEl('line'), { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: '#252a40', 'stroke-width': '1' }));
      var yLbl = setAttrs(svgEl('text'), { x: padL - 20, y: gy + 4, 'text-anchor': 'end', fill: '#5b6178', 'font-size': '11' });
      yLbl.textContent = Math.round(gt) + '\u00B0';
      svg.appendChild(yLbl);
    }

    // Active column highlight (drawn under everything)
    var colW = plotW / n;
    if (_activeHourTs !== null) {
      slice.forEach(function (h, i) {
        if (h.time.getTime() !== _activeHourTs) return;
        svg.appendChild(setAttrs(svgEl('rect'), {
          x: (padL + i * colW).toFixed(1), y: padT,
          width: colW.toFixed(1), height: plotH,
          fill: 'rgba(45,212,191,0.15)', rx: '3'
        }));
      });
    }

    // Precipitation bars — inside the plot area, behind the temperature curve
    slice.forEach(function (h, i) {
      var p = h.precipitationProbability || 0;
      if (p < 5) return;
      var bh = (p / 100) * plotH;
      var bw = Math.max(4, colW * 0.55);
      var bx = padL + i * colW + (colW - bw) / 2;
      svg.appendChild(setAttrs(svgEl('rect'), {
        x: bx.toFixed(1), y: (padT + plotH - bh).toFixed(1),
        width: bw.toFixed(1), height: bh.toFixed(1),
        fill: 'rgba(56,189,248,0.13)', rx: '2'
      }));
    });

    // Area fill + smooth line
    svg.appendChild(setAttrs(svgEl('path'), { d: areaPath, fill: 'url(#tcArea)' }));
    svg.appendChild(setAttrs(svgEl('path'), {
      d: linePath, fill: 'none',
      stroke: 'url(#tcLine)', 'stroke-width': '2.5',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }));

    // Dots + labels every 3 h
    slice.forEach(function (h, i) {
      var px = pts[i].x, py = pts[i].y;
      var isNow      = i === 0;
      var isActive   = h.time.getTime() === _activeHourTs;
      var showLabel  = isNow || i % 3 === 0;

      svg.appendChild(setAttrs(svgEl('circle'), {
        cx: px.toFixed(1), cy: py.toFixed(1), r: showLabel ? '4' : '2.5',
        fill: isActive ? '#2dd4bf' : (isNow ? '#38bdf8' : '#2dd4bf'),
        stroke: isActive ? '#fff' : '#1a1d2e', 'stroke-width': isActive ? '2.5' : '2'
      }));

      if (showLabel) {
        var tLbl = setAttrs(svgEl('text'), {
          x: px.toFixed(1), y: (py - 12).toFixed(1),
          'text-anchor': 'middle', fill: '#e6e9f2', 'font-size': '10', 'font-weight': '600'
        });
        tLbl.textContent = Math.round(h.temperature) + '\u00B0';
        svg.appendChild(tLbl);

        var timeLbl = setAttrs(svgEl('text'), {
          x: px.toFixed(1), y: (barAreaY - 4).toFixed(1),
          'text-anchor': 'middle',
          fill: isActive ? '#2dd4bf' : (isNow ? '#38bdf8' : '#8892b0'),
          'font-size': '11', 'font-weight': (isNow || isActive) ? '600' : '400'
        });
        timeLbl.textContent = isNow ? 'Jetzt' : hourFmt.format(h.time);
        svg.appendChild(timeLbl);
      }
    });

    // Invisible hit columns — on top, cover full height including time label row
    slice.forEach(function (h, i) {
      var hitRect = setAttrs(svgEl('rect'), {
        x: (padL + i * colW).toFixed(1), y: '0',
        width: colW.toFixed(1), height: H,
        fill: 'transparent',
        'data-hour-ts': String(h.time.getTime())
      });
      svg.appendChild(hitRect);
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
        var onsetDate   = localDateFmt.format(a.onset);
        var expiresDate = localDateFmt.format(a.expires);
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

  // ---------- Hourly time-peek: hero update ----------
  function renderHeroForHour(h, data) {
    var heroIcon     = document.getElementById('hero-icon');
    var heroTemp     = document.getElementById('hero-temp');
    var heroDesc     = document.getElementById('hero-desc');
    var statFeels    = document.getElementById('stat-feels');
    var statHighLow  = document.getElementById('stat-highlow');
    var statWind     = document.getElementById('stat-wind');
    var statHumidity = document.getElementById('stat-humidity');
    var statUv       = document.getElementById('stat-uv');
    var statPrecip   = document.getElementById('stat-precip');

    if (heroIcon)     heroIcon.textContent     = h.description.icon;
    if (heroTemp)     heroTemp.textContent     = round(h.temperature) + '\u00B0';
    if (heroDesc)     heroDesc.textContent     = h.description.label;
    if (statFeels)    statFeels.textContent    = h.apparent    !== null ? round(h.apparent)  + '\u00B0'  : '--';
    if (statWind) {
      var hWd = windDirArrow(h.windDirection);
      var hBft = h.windSpeed !== null ? beaufort(h.windSpeed) : null;
      statWind.textContent = h.windSpeed !== null
        ? (hWd.arrow ? hWd.arrow + '\u00A0' : '') + round(h.windSpeed) + ' km/h' : '--';
      var hwMeta = document.getElementById('stat-wind-meta');
      if (hwMeta) hwMeta.textContent = hBft !== null ? 'Bft\u00A0' + hBft + (hWd.compass ? '\u00A0\u00B7\u00A0' + hWd.compass : '') : '';
    }
    if (statHumidity) statHumidity.textContent = h.humidity    !== null ? round(h.humidity)  + ' %'      : '--';
    if (statUv) {
      statUv.textContent = h.uvIndex !== null ? fmtNum(h.uvIndex, 1) : '--';
      var huvMeta = document.getElementById('stat-uv-meta');
      if (huvMeta) huvMeta.textContent = h.uvIndex !== null ? uvRisk(h.uvIndex) : '';
    }
    if (statPrecip)   statPrecip.textContent   = h.precipitation !== null ? fmtNum(h.precipitation, 1) + ' mm' : '--';

    // High/Low from the daily entry that covers this hour's calendar day
    var hDateStr = localDateFmt.format(h.time);
    var dayEntry = null;
    if (data.daily) {
      for (var i = 0; i < data.daily.length; i++) {
        if (localDateFmt.format(data.daily[i].date) === hDateStr) { dayEntry = data.daily[i]; break; }
      }
    }
    if (!dayEntry && data.daily && data.daily.length) dayEntry = data.daily[0];
    if (statHighLow) statHighLow.textContent = dayEntry
      ? round(dayEntry.tempMax) + '\u00B0 / ' + round(dayEntry.tempMin) + '\u00B0' : '--';

    // Weather-alert chip — reflects hour's weather code
    _renderAlertChip(document.getElementById('weather-alert'), h.weatherCode, '');

    // Hide rain-timing pill (relative to "now", not meaningful for a pinned time)
    var timingEl = document.getElementById('rain-timing');
    if (timingEl) timingEl.hidden = true;

    // Subtitle → "15:00 Uhr · Stadtname"
    var subtitle = document.getElementById('subtitle');
    if (subtitle && data.location) {
      subtitle.textContent = hourFmt.format(h.time) + ' Uhr \u00B7 ' + data.location.name + ', ' + data.location.country;
    }
  }

  function _showHourHero(ts) {
    if (!_lastData) return;
    for (var i = 0; i < _lastData.hourly.length; i++) {
      if (_lastData.hourly[i].time.getTime() === ts) {
        renderHeroForHour(_lastData.hourly[i], _lastData);
        return;
      }
    }
  }

  function _restoreLiveHero() {
    if (!_lastData) return;
    renderHero(_lastData);
    var subtitle = document.getElementById('subtitle');
    var loc = _lastData.location;
    if (subtitle && loc) subtitle.textContent = 'Live-Wetter für ' + loc.name + ', ' + loc.country;
  }

  // ---------- Hourly radar-frame interaction ----------
  function _handleHourActivation(ts) {
    if (_activeHourTs === ts) {
      _activeHourTs = null;
      if (window.WeatherMap && window.WeatherMap.resetRadarFrame) window.WeatherMap.resetRadarFrame();
      _restoreLiveHero();
      _updateActiveHourUI(null);
    } else {
      _activeHourTs = ts;
      // Map: try to show radar frame — shows toast if outside available range, that's fine
      if (window.WeatherMap && window.WeatherMap.setRadarFrame) window.WeatherMap.setRadarFrame(ts);
      // Hero: always update to that hour's data
      _showHourHero(ts);
      _updateActiveHourUI(ts);
    }
  }

  function _updateActiveHourUI(ts) {
    var strip = document.getElementById('hourly-strip');
    if (strip) {
      strip.querySelectorAll('.hourly-item').forEach(function (item) {
        var itemTs = parseInt(item.dataset.hourTs || '0', 10);
        item.classList.toggle('radar-active', ts !== null && itemTs === ts);
      });
    }
    var chart = document.getElementById('hourly-chart');
    if (_lastData && chart && !chart.hidden) renderTempChart(_lastData);
  }

  function initHourlyMapClick() {
    var strip = document.getElementById('hourly-strip');
    if (strip && !strip._mapClickAttached) {
      strip._mapClickAttached = true;
      strip.addEventListener('click', function (e) {
        var item = e.target.closest('[data-hour-ts]');
        if (!item) return;
        var ts = parseInt(item.dataset.hourTs, 10);
        if (!isNaN(ts)) _handleHourActivation(ts);
      });
    }

    var chart = document.getElementById('hourly-chart');
    if (chart && !chart._mapClickAttached) {
      chart._mapClickAttached = true;
      chart.addEventListener('click', function (e) {
        var hit = e.target.closest('[data-hour-ts]');
        if (!hit) return;
        var ts = parseInt(hit.getAttribute('data-hour-ts'), 10);
        if (!isNaN(ts)) _handleHourActivation(ts);
      });
    }
  }

  function clearActiveHour() {
    _activeHourTs = null;
    var strip = document.getElementById('hourly-strip');
    if (strip) strip.querySelectorAll('.radar-active').forEach(function (el) { el.classList.remove('radar-active'); });
  }

  // ---------- AQI card ----------
  function updateAqiBadge(aqiData) {
    var badge = document.getElementById('aqi-badge');
    if (!badge) return;
    var eaqi = aqiData && aqiData.current ? aqiData.current.eaqi : null;
    if (typeof eaqi !== 'number' || eaqi < 60) { badge.hidden = true; return; }
    var info = window.WeatherAPI.aqiColorInfo(eaqi);
    badge.className = 'weather-alert ' + (info ? info.cls : '');
    badge.textContent = 'AQI ' + Math.round(eaqi) + ' · ' + (info ? info.label : '');
    badge.hidden = false;
  }

  function setAqiCardVisible(on) {
    var card = document.getElementById('aqi-card');
    if (card) card.hidden = !on;
  }

  function isAqiCardVisible() {
    var card = document.getElementById('aqi-card');
    return !!(card && !card.hidden);
  }

  function renderAqiChart(aqiData) {
    var currentEl = document.getElementById('aqi-current');
    if (currentEl) {
      clearChildren(currentEl);
      if (aqiData) {
        var c    = aqiData.current;
        var info = window.WeatherAPI.aqiColorInfo(c.eaqi);
        var main = document.createElement('div');
        main.className = 'aqi-main';
        var valEl = document.createElement('span');
        valEl.className = 'aqi-value' + (info ? ' ' + info.cls : '');
        valEl.textContent = c.eaqi !== null ? String(Math.round(c.eaqi)) : '--';
        var lblEl = document.createElement('span');
        lblEl.className   = 'aqi-label';
        lblEl.textContent = info ? info.label : 'Keine Daten';
        main.appendChild(valEl);
        main.appendChild(lblEl);
        currentEl.appendChild(main);

        var subStats = document.createElement('div');
        subStats.className = 'aqi-sub-stats';
        [
          { l: 'PM2.5', v: c.pm25  !== null ? fmtNum(c.pm25,  1) + ' µg/m³' : '--' },
          { l: 'PM10',  v: c.pm10  !== null ? fmtNum(c.pm10,  1) + ' µg/m³' : '--' },
          { l: 'Ozon',  v: c.ozone !== null ? fmtNum(c.ozone, 1) + ' µg/m³' : '--' }
        ].forEach(function (s) {
          var item = document.createElement('div');
          item.className = 'aqi-sub-item';
          var lEl = document.createElement('span');
          lEl.className = 'aqi-sub-label'; lEl.textContent = s.l;
          var vEl = document.createElement('span');
          vEl.className = 'aqi-sub-value'; vEl.textContent = s.v;
          item.appendChild(lEl); item.appendChild(vEl);
          subStats.appendChild(item);
        });
        currentEl.appendChild(subStats);
      }
    }

    var container = document.getElementById('aqi-chart');
    if (!container) return;
    if (!aqiData || !aqiData.hourly || !aqiData.hourly.length) { clearChildren(container); return; }

    var now = Date.now();
    var slice = aqiData.hourly.filter(function (h) {
      return h.time.getTime() >= now - 30 * 60 * 1000;
    }).slice(0, 25);
    if (slice.length < 2) { clearChildren(container); return; }

    var W = 760, H = 160;
    var padL = 36, padR = 16, padT = 24, padB = 50;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var n     = slice.length;
    var slotW = plotW / n;
    var barW  = slotW * 0.72;
    var yMax  = Math.max(100, Math.max.apply(null, slice.map(function (h) { return h.eaqi || 0; })) * 1.1);

    function yOf(v)   { return padT + (1 - (v || 0) / yMax) * plotH; }
    function barCX(i) { return padL + i * slotW + slotW / 2; }

    var svg = setAttrs(svgEl('svg'), {
      viewBox: '0 0 ' + W + ' ' + H,
      'class': 'aqi-chart-svg',
      'aria-hidden': 'true'
    });

    [20, 40, 60, 80, 100].forEach(function (v) {
      if (v > yMax * 1.05) return;
      var gy = yOf(v);
      svg.appendChild(setAttrs(svgEl('line'), {
        x1: padL, x2: W - padR, y1: gy.toFixed(1), y2: gy.toFixed(1),
        stroke: '#252a40', 'stroke-width': '1', 'stroke-dasharray': '3 4'
      }));
      var lbl = setAttrs(svgEl('text'), {
        x: padL - 4, y: (gy + 4).toFixed(1), 'text-anchor': 'end',
        fill: '#5b6178', 'font-size': '10'
      });
      lbl.textContent = String(v);
      svg.appendChild(lbl);
    });

    slice.forEach(function (h, i) {
      if (h.eaqi === null) return;
      var info  = window.WeatherAPI.aqiColorInfo(h.eaqi);
      var color = info ? info.color : '#38bdf8';
      var barH  = Math.max(2, (h.eaqi / yMax) * plotH);
      var bx    = padL + i * slotW + (slotW - barW) / 2;
      var by    = padT + plotH - barH;
      svg.appendChild(setAttrs(svgEl('rect'), {
        x: bx.toFixed(1), y: by.toFixed(1),
        width: barW.toFixed(1), height: barH.toFixed(1),
        fill: color, opacity: '0.75', rx: '2'
      }));
      var vLbl = setAttrs(svgEl('text'), {
        x: barCX(i).toFixed(1), y: Math.max(padT + 11, by - 3).toFixed(1),
        'text-anchor': 'middle', fill: color, 'font-size': '9', 'font-weight': '600'
      });
      vLbl.textContent = String(Math.round(h.eaqi));
      svg.appendChild(vLbl);
    });

    var labelY = padT + plotH + 14;
    slice.forEach(function (h, i) {
      var lx   = barCX(i);
      var fill = i === 0 ? '#38bdf8' : '#8892b0';
      var tLbl = setAttrs(svgEl('text'), {
        x: lx.toFixed(1), y: String(labelY),
        'text-anchor': 'end',
        fill: fill,
        'font-size': '10', 'font-weight': i === 0 ? '600' : '400',
        transform: 'rotate(-40, ' + lx.toFixed(1) + ', ' + labelY + ')'
      });
      tLbl.textContent = i === 0 ? 'Jetzt' : hourFmt.format(h.time);
      svg.appendChild(tLbl);
    });

    clearChildren(container);
    container.appendChild(svg);
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
    setTimezone:        setTimezone,
    renderHero:         renderHero,
    renderSun:          renderSun,
    renderHourly:       renderHourly,
    renderTempChart:    renderTempChart,
    initHourlyToggle:   initHourlyToggle,
    initHourlyMapClick: initHourlyMapClick,
    clearActiveHour:    clearActiveHour,
    renderDaily:        renderDaily,
    renderDayDetail:    renderDayDetail,
    hideDayDetail:      hideDayDetail,
    renderAlerts:       renderAlerts,
    renderUpdatedAt:    renderUpdatedAt,
    showError:          showError,
    hideError:          hideError,
    setRefreshing:      setRefreshing,
    updateAqiBadge:     updateAqiBadge,
    setAqiCardVisible:  setAqiCardVisible,
    isAqiCardVisible:   isAqiCardVisible,
    renderAqiChart:     renderAqiChart
  };
})();
