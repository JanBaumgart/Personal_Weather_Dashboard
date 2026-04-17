# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

Open `index.html` directly in a browser — no build step, no dev server, no npm. The app fetches live data from the Open-Meteo API on load.

There are no tests, no linter config, and no package.json.

## Architecture

The app uses an **IIFE + `window.*` global namespace** pattern instead of ES modules. This is intentional: native `import/export` is blocked on `file://` protocol, and there is no bundler. Script load order in `index.html` is significant — `weather.js` → `map.js` → `ui.js` → `app.js`.

### Module responsibilities

| File | Responsibility |
|------|---------------|
| `js/weather.js` | Open-Meteo API fetch, WMO code table, raw→internal data shape. Exposes `window.WeatherAPI`. |
| `js/map.js` | Leaflet map init (centred on Germany), Nuremberg marker, live popup update. Exposes `window.WeatherMap`. |
| `js/ui.js` | All DOM rendering: hero, sun arc, hourly strip, daily grid, error banner, refresh state. Exposes `window.WeatherUI`. |
| `js/app.js` | Orchestration: calls the above three in sequence, wires refresh button, runs 10-min auto-refresh, pauses on hidden tab. |

### Data flow

`app.js` calls `WeatherAPI.fetchWeather()` → returns a normalised `{ location, units, current, daily, hourly, fetchedAt }` object → passed to individual `WeatherUI.render*()` functions → `WeatherMap.updateMarkerPopup()` gets just `current`.

### Key conventions

- **WMO codes**: `weather.js` maps all Open-Meteo WMO codes (0–99) to `{ label, icon }`. Adding a new code means adding one entry to the `WEATHER_CODES` object in that file.
- **Date parsing**: Open-Meteo returns timezone-naive ISO strings (e.g. `"2026-04-17T14:00"`). `ui.js:parseLocalIsoAsDate()` handles this — do not pass raw API time strings directly to `new Date()` elsewhere.
- **Locale**: All formatting uses `de-DE` locale and `Europe/Berlin` timezone via `Intl.DateTimeFormat`.
- **Skeleton loading**: HTML includes `.skeleton-text` / `.skeleton-box` placeholder elements; `ui.js:removeSkeleton()` strips the class once real data arrives.
- **Sun arc SVG**: The arc is a fixed `viewBox="0 0 300 160"` semicircle path. The `#sun-dot` circle `cx/cy` is computed in `renderSun()` using trigonometry against the path's geometric centre `(150, 140)` with radius 130.
