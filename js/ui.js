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
    const grid = document.getElementById('daily-grid');

    if (!data.daily || !data.daily.length) {
      clearChildren(grid);
      grid.textContent = 'Keine Tagesdaten verfügbar.';
      return;
    }

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
      return;
    }

    // First render: full build via DocumentFragment.
    const frag = document.createDocumentFragment();
    data.daily.forEach(function (d, idx) {
      const item    = document.createElement('div');
      item.className = 'daily-item';

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
    renderHero:      renderHero,
    renderSun:       renderSun,
    renderHourly:    renderHourly,
    renderDaily:     renderDaily,
    renderUpdatedAt: renderUpdatedAt,
    showError:       showError,
    hideError:       hideError,
    setRefreshing:   setRefreshing
  };
})();
