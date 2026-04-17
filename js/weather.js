/* ==========================================================================
   weather.js — Open-Meteo API fetching & data parsing
   ========================================================================== */

/* global window */

(function () {
  'use strict';

  const LOCATION = {
    name: 'Nürnberg',
    country: 'DE',
    lat: 49.45,
    lon: 11.08,
    timezone: 'Europe/Berlin'
  };

  // URL built from LOCATION so coordinates aren't duplicated.
  // timeformat=unixtime avoids timezone-naive ISO strings entirely.
  const API_URL =
    'https://api.open-meteo.com/v1/forecast' +
    '?latitude=' + LOCATION.lat + '&longitude=' + LOCATION.lon +
    '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,apparent_temperature,precipitation,weather_code,uv_index' +
    '&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,uv_index_max,precipitation_sum' +
    '&hourly=temperature_2m,weather_code,precipitation_probability' +
    '&timezone=Europe%2FBerlin' +
    '&timeformat=unixtime' +
    '&forecast_days=7';

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

  async function fetchWeather() {
    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ' ' + response.statusText);
    }
    const data = await response.json();
    return parseWeather(data);
  }

  function parseWeather(raw) {
    const c = raw.current || {};
    const d = raw.daily   || {};
    const h = raw.hourly  || {};

    const current = {
      time:          c.time ? new Date(c.time * 1000) : null,
      temperature:   c.temperature_2m,
      apparent:      c.apparent_temperature,
      humidity:      c.relative_humidity_2m,
      windSpeed:     c.wind_speed_10m,
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
      time:                     hourlyTimes  = [],
      temperature_2m:           hourlyTemp   = [],
      weather_code:             hourlyWc     = [],
      precipitation_probability: hourlyPrecip = []
    } = h;

    const hourly = hourlyTimes.map(function (ts, i) {
      return {
        time:                    new Date(ts * 1000),
        temperature:             hourlyTemp[i]   ?? null,
        weatherCode:             hourlyWc[i]     ?? null,
        precipitationProbability: hourlyPrecip[i] ?? null,
        description:             describeWeather(hourlyWc[i] ?? null)
      };
    });

    return {
      location: LOCATION,
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

  window.WeatherAPI = {
    LOCATION:        LOCATION,
    fetchWeather:    fetchWeather,
    describeWeather: describeWeather
  };
})();
