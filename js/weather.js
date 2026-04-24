/* ==========================================================================
   weather.js — Open-Meteo API fetching & data parsing
   ========================================================================== */

/* global window */

(function () {
  'use strict';

  const DEFAULT_LOCATION = {
    name: 'Nürnberg',
    country: 'DE',
    lat: 49.45,
    lon: 11.08,
    timezone: 'Europe/Berlin'
  };

  let activeLocation = Object.assign({}, DEFAULT_LOCATION);

  /**
   * Validate a numeric coordinate: must be finite and within [min, max].
   * Throws on invalid input so callers fail loudly instead of propagating NaN
   * into Leaflet (setView(NaN, NaN) crashes) or building malformed API URLs.
   */
  function clampCoord(v, min, max, label) {
    var n = Number(v);
    if (!isFinite(n) || n < min || n > max) throw new Error('Invalid coord ' + label + ': ' + v);
    return n;
  }

  function buildApiUrl(loc) {
    return 'https://api.open-meteo.com/v1/forecast' +
      '?latitude='  + loc.lat + '&longitude=' + loc.lon +
      '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,apparent_temperature,precipitation,weather_code,uv_index' +
      '&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,uv_index_max,precipitation_sum' +
      '&hourly=temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,relative_humidity_2m,uv_index,precipitation,weather_code,precipitation_probability' +
      '&timezone=' + encodeURIComponent(loc.timezone || 'Europe/Berlin') +
      '&timeformat=unixtime' +
      '&forecast_days=7' +
      '&models=icon_seamless';
  }

  function buildAlertsUrl(loc) {
    return 'https://api.brightsky.dev/alerts?lat=' + loc.lat + '&lon=' + loc.lon;
  }

  function setLocation(loc) {
    activeLocation = {
      name:     String(loc.name    || '').slice(0, 100),
      country:  String(loc.country || '').slice(0, 10),
      lat:      clampCoord(loc.lat, -90, 90, 'lat'),
      lon:      clampCoord(loc.lon, -180, 180, 'lon'),
      timezone: String(loc.timezone || 'Europe/Berlin').slice(0, 50)
    };
  }

  function getLocation() {
    return Object.assign({}, activeLocation);
  }

  /**
   * Map WMO weather codes to human-readable labels and emoji icons.
   * Reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes)
   */
  const WEATHER_CODES = {
    0:  { label: 'Klar',                         icon: '☀️' },
    1:  { label: 'Überwiegend klar',             icon: '🌤️' },
    2:  { label: 'Teils bewölkt',                icon: '⛅' },
    3:  { label: 'Bedeckt',                      icon: '☁️' },
    45: { label: 'Nebel',                        icon: '🌫️' },
    48: { label: 'Reifnebel',                    icon: '🌫️' },
    51: { label: 'Leichter Nieselregen',         icon: '🌦️' },
    53: { label: 'Nieselregen',                  icon: '🌦️' },
    55: { label: 'Starker Nieselregen',          icon: '🌦️' },
    56: { label: 'Gefrierender Niesel',          icon: '🌨️' },
    57: { label: 'Starker gefr. Niesel',         icon: '🌨️' },
    61: { label: 'Leichter Regen',               icon: '🌧️' },
    63: { label: 'Regen',                        icon: '🌧️' },
    65: { label: 'Starker Regen',                icon: '🌧️' },
    66: { label: 'Gefrierender Regen',           icon: '🌨️' },
    67: { label: 'Starker gefr. Regen',          icon: '🌨️' },
    71: { label: 'Leichter Schneefall',          icon: '🌨️' },
    73: { label: 'Schneefall',                   icon: '🌨️' },
    75: { label: 'Starker Schneefall',           icon: '❄️' },
    77: { label: 'Schneegriesel',                icon: '🌨️' },
    80: { label: 'Leichte Regenschauer',         icon: '🌦️' },
    81: { label: 'Regenschauer',                 icon: '🌦️' },
    82: { label: 'Starke Regenschauer',          icon: '⛈️' },
    85: { label: 'Leichte Schneeschauer',        icon: '🌨️' },
    86: { label: 'Starke Schneeschauer',         icon: '❄️' },
    95: { label: 'Gewitter',                     icon: '⛈️' },
    96: { label: 'Gewitter mit leichtem Hagel',  icon: '⛈️' },
    99: { label: 'Gewitter mit starkem Hagel',   icon: '⛈️' }
  };

  function describeWeather(code) {
    if (Object.prototype.hasOwnProperty.call(WEATHER_CODES, code)) {
      return WEATHER_CODES[code];
    }
    return { label: 'Unbekannt', icon: '❓' };
  }

  const VALID_SEVERITIES = new Set(['minor', 'moderate', 'severe', 'extreme']);

  function safeParseDate(str) {
    if (typeof str !== 'string') return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function trimStr(s, max) {
    return typeof s === 'string' ? s.slice(0, max) : '';
  }

  function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, { signal: ctrl.signal }).finally(function () { clearTimeout(t); });
  }

  async function geocode(query) {
    const q = String(query).trim().slice(0, 100);
    if (!q) return [];
    const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
      encodeURIComponent(q) + '&count=10&language=de&format=json';
    const resp = await fetchWithTimeout(url, 10000);
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + resp.statusText);
    const data = await resp.json();
    return (data.results || []).reduce(function (acc, r) {
      var lat, lon;
      try {
        lat = clampCoord(r.latitude,  -90,  90, 'lat');
        lon = clampCoord(r.longitude, -180, 180, 'lon');
      } catch (e) {
        // Skip results with corrupt coordinates instead of crashing the whole list.
        if (window.console) console.warn('[WeatherAPI] geocode: dropped invalid result', e);
        return acc;
      }
      const parts = [String(r.name || '').slice(0, 100)];
      if (r.admin1) parts.push(String(r.admin1).slice(0, 100));
      parts.push(String(r.country || r.country_code || '').slice(0, 60));
      acc.push({
        name:        String(r.name        || '').slice(0, 100),
        country:     String(r.country_code || '').slice(0, 10),
        admin1:      String(r.admin1       || '').slice(0, 100),
        lat:         lat,
        lon:         lon,
        timezone:    String(r.timezone     || 'GMT').slice(0, 50),
        displayName: parts.join(', ')
      });
      return acc;
    }, []);
  }

  async function fetchAlerts() {
    const response = await fetchWithTimeout(buildAlertsUrl(activeLocation), 15000);
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ' ' + response.statusText);
    }
    const data = await response.json();
    return (data.alerts || []).map(function (a) {
      const sev = typeof a.severity === 'string' ? a.severity.toLowerCase() : 'minor';
      return {
        id:          a.id,
        severity:    VALID_SEVERITIES.has(sev) ? sev : 'minor',
        event:       trimStr(a.event_de   || a.event_en,   100),
        headline:    trimStr(a.headline_de || a.headline_en, 500),
        description: trimStr(a.description_de || a.description_en, 2000),
        instruction: trimStr(a.instruction_de || a.instruction_en, 2000),
        onset:       safeParseDate(a.onset),
        expires:     safeParseDate(a.expires)
      };
    });
  }

  async function fetchWeather() {
    const loc      = activeLocation;
    const response = await fetchWithTimeout(buildApiUrl(loc), 15000);
    if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + response.statusText);
    const data = await response.json();
    return parseWeather(data, loc);
  }

  function parseWeather(raw, loc) {
    const c = raw.current || {};
    const d = raw.daily   || {};
    const h = raw.hourly  || {};

    const current = {
      time:          c.time ? new Date(c.time * 1000) : null,
      temperature:   c.temperature_2m,
      apparent:      c.apparent_temperature,
      humidity:      c.relative_humidity_2m,
      windSpeed:     c.wind_speed_10m,
      windDirection: c.wind_direction_10m,
      precipitation: c.precipitation,
      uvIndex:       c.uv_index,
      weatherCode:   c.weather_code,
      description:   describeWeather(c.weather_code)
    };

    // Destructure daily arrays once — avoids repeated falsy checks.
    const {
      time:               dailyTimes    = [],
      temperature_2m_max: tempMax       = [],
      temperature_2m_min: tempMin       = [],
      weather_code:       dailyWc       = [],
      sunrise:            sunriseTimes  = [],
      sunset:             sunsetTimes   = [],
      uv_index_max:       uvMax         = [],
      precipitation_sum:  precipSum     = []
    } = d;

    const daily = dailyTimes.map(function (ts, i) {
      return {
        date:            new Date(ts * 1000),
        tempMax:         tempMax[i]      ?? null,
        tempMin:         tempMin[i]      ?? null,
        weatherCode:     dailyWc[i]      ?? null,
        sunrise:         sunriseTimes[i] ? new Date(sunriseTimes[i] * 1000) : null,
        sunset:          sunsetTimes[i]  ? new Date(sunsetTimes[i]  * 1000) : null,
        uvIndexMax:      uvMax[i]        ?? null,
        precipitationSum: precipSum[i]   ?? null,
        description:     describeWeather(dailyWc[i] ?? null)
      };
    });

    const {
      time:                     hourlyTimes    = [],
      temperature_2m:           hourlyTemp     = [],
      apparent_temperature:     hourlyApparent = [],
      wind_speed_10m:           hourlyWind     = [],
      wind_direction_10m:       hourlyWindDir  = [],
      relative_humidity_2m:     hourlyHumidity = [],
      uv_index:                 hourlyUv       = [],
      precipitation:            hourlyPrecipMm = [],
      weather_code:             hourlyWc       = [],
      precipitation_probability: hourlyPrecip  = []
    } = h;

    const hourly = hourlyTimes.map(function (ts, i) {
      return {
        time:                    new Date(ts * 1000),
        temperature:             hourlyTemp[i]     ?? null,
        apparent:                hourlyApparent[i] ?? null,
        windSpeed:               hourlyWind[i]     ?? null,
        windDirection:           hourlyWindDir[i]  ?? null,
        humidity:                hourlyHumidity[i] ?? null,
        uvIndex:                 hourlyUv[i]       ?? null,
        precipitation:           hourlyPrecipMm[i] ?? null,
        weatherCode:             hourlyWc[i]       ?? null,
        precipitationProbability: hourlyPrecip[i]  ?? null,
        description:             describeWeather(hourlyWc[i] ?? null)
      };
    });

    return {
      location: loc || activeLocation,
      units: {
        temperature: (raw.current_units && raw.current_units.temperature_2m) || '°C',
        wind:        (raw.current_units && raw.current_units.wind_speed_10m)  || 'km/h',
        humidity:    '%',
        precipitation: 'mm'
      },
      current:   current,
      daily:     daily,
      hourly:    hourly,
      fetchedAt: new Date()
    };
  }

  async function fetchCurrentForLoc(loc) {
    const url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude='  + loc.lat + '&longitude=' + loc.lon +
      '&current=temperature_2m,weather_code' +
      '&timezone='  + encodeURIComponent(loc.timezone || 'Europe/Berlin') +
      '&timeformat=unixtime';
    const resp = await fetchWithTimeout(url, 10000);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const c = data.current || {};
    return {
      temperature:  c.temperature_2m,
      weatherCode:  c.weather_code,
      description:  describeWeather(c.weather_code)
    };
  }

  // Strip bidi overrides + control chars from remote strings before rendering/
  // writing them to document.title (prevents tab-title spoofing via U+202E etc.).
  function sanitizeDisplay(s) {
    // C0/DEL/C1 controls + zero-width + bidi marks/overrides + isolates.
    return String(s).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  }

  // Conservative IANA timezone shape — rejects anything that wouldn't be a valid
  // tz identifier before it reaches Intl.DateTimeFormat (RangeError guard).
  var TZ_RE = /^[A-Za-z_]+(?:\/[A-Za-z_+\-0-9]+){0,2}$/;

  function buildAqiUrl(loc) {
    const lat = Number(loc.lat), lon = Number(loc.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error('Invalid coordinates');
    }
    const tz = encodeURIComponent(String(loc.timezone || 'Europe/Berlin').slice(0, 50));
    return 'https://air-quality-api.open-meteo.com/v1/air-quality' +
      '?latitude=' + lat.toFixed(5) +
      '&longitude=' + lon.toFixed(5) +
      '&current=european_aqi,pm2_5,pm10,ozone' +
      '&hourly=european_aqi' +
      '&timezone=' + tz +
      '&forecast_days=2';
  }

  function aqiColorInfo(eaqi) {
    if (typeof eaqi !== 'number' || isNaN(eaqi)) return null;
    if (eaqi <= 20)  return { cls: 'aqi-very-good', label: 'Sehr gut',        color: '#22c55e' };
    if (eaqi <= 40)  return { cls: 'aqi-good',      label: 'Gut',             color: '#84cc16' };
    if (eaqi <= 60)  return { cls: 'aqi-moderate',  label: 'Mäßig',           color: '#eab308' };
    if (eaqi <= 80)  return { cls: 'aqi-poor',      label: 'Schlecht',        color: '#f97316' };
    if (eaqi <= 100) return { cls: 'aqi-very-poor', label: 'Sehr schlecht',   color: '#ef4444' };
    return                  { cls: 'aqi-hazardous', label: 'Extrem schlecht', color: '#a855f7' };
  }

  async function fetchAqi() {
    const loc  = activeLocation;
    const resp = await fetchWithTimeout(buildAqiUrl(loc), 15000);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const c    = data.current || {};
    const h    = data.hourly  || {};
    const times   = h.time         || [];
    const eaqiArr = h.european_aqi || [];
    return {
      current: {
        eaqi:  typeof c.european_aqi === 'number' ? c.european_aqi : null,
        pm25:  typeof c.pm2_5        === 'number' ? c.pm2_5        : null,
        pm10:  typeof c.pm10         === 'number' ? c.pm10         : null,
        ozone: typeof c.ozone        === 'number' ? c.ozone        : null
      },
      hourly: times.map(function (ts, i) {
        return { time: new Date(ts * 1000), eaqi: eaqiArr[i] ?? null };
      })
    };
  }

  async function reverseGeocode(lat, lon) {
    const la = Number(lat), lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) ||
        la < -90 || la > 90 || lo < -180 || lo > 180) {
      throw new Error('Invalid coordinates');
    }
    const nominatimUrl = 'https://nominatim.openstreetmap.org/reverse?format=json' +
      '&lat=' + la.toFixed(5) + '&lon=' + lo.toFixed(5) +
      '&zoom=10&accept-language=de';
    const openMeteoUrl = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + la.toFixed(5) + '&longitude=' + lo.toFixed(5) +
      '&current=temperature_2m&timezone=auto&timeformat=unixtime';

    const [nominatimResult, timezoneResult] = await Promise.allSettled([
      fetchWithTimeout(nominatimUrl, 5000).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }),
      fetchWithTimeout(openMeteoUrl, 5000).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    ]);

    var name = 'Mein Standort';
    var country = '';
    if (nominatimResult.status === 'fulfilled') {
      var addr = nominatimResult.value.address || {};
      var raw = addr.city || addr.town || addr.village || addr.county || '';
      if (raw) name = sanitizeDisplay(raw).slice(0, 100) || 'Mein Standort';
      if (addr.country_code) country = sanitizeDisplay(addr.country_code).toUpperCase().slice(0, 10);
    }

    var timezone = 'UTC';
    if (timezoneResult.status === 'fulfilled') {
      var tz = timezoneResult.value.timezone;
      if (tz && TZ_RE.test(tz) && tz.length <= 50) timezone = String(tz);
    }

    return { name: name, country: country, timezone: timezone };
  }

  window.WeatherAPI = {
    DEFAULT_LOCATION:    DEFAULT_LOCATION,
    getLocation:         getLocation,
    setLocation:         setLocation,
    fetchWeather:        fetchWeather,
    fetchCurrentForLoc:  fetchCurrentForLoc,
    fetchAlerts:         fetchAlerts,
    describeWeather:     describeWeather,
    geocode:             geocode,
    reverseGeocode:      reverseGeocode,
    fetchAqi:            fetchAqi,
    aqiColorInfo:        aqiColorInfo
  };
})();
