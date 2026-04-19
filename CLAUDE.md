# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

**Do not open `index.html` directly** — OSM tile servers return 403 for `file://` requests (no Referer header). The app must be served via a local HTTP server.

### Launcher (Windows)

Two VBScript files in the project root handle this:

| Datei | Funktion |
|-------|----------|
| `Wetter Dashboard.vbs` | Startet `python -m http.server` unsichtbar im Hintergrund, öffnet den Standard-Browser auf `http://localhost:8080`. Prüft zuerst ob der Server bereits läuft (kein Doppelstart). Falls Port 8080 belegt ist, wird automatisch 8081–8083 probiert mit kurzem Hinweis-Dialog. |
| `Wetter Dashboard beenden.vbs` | Findet den Server-Prozess via `netstat` (PID), stoppt nur diesen — nicht alle python.exe-Prozesse. |

Voraussetzung: Python 3 muss installiert und im PATH sein (`python --version` muss funktionieren).

### Manuell (alternativ)

```bash
python -m http.server 8080
```

Dann im Browser: `http://localhost:8080`

There are no tests, no linter config, and no package.json.

## Deployment (Vercel)

Die App ist als statische Site auf Vercel deployed:

- **Live URL**: `https://weather-dashboard-liard-six.vercel.app`
- **Vercel Projekt**: `janbaumgarts-projects/weather-dashboard`
- **GitHub Repo**: `JanBaumgart/Personal_Weather_Dashboard`
- **Auto-Deploy**: jeder Push auf `main` triggert automatisch ein Vercel Production Deployment

Manuelles Deploy (falls nötig):
```bash
vercel --prod
```

Vercel konfiguriert kein Build-Command — die App ist reines HTML/CSS/JS, Output Directory ist `.` (Root). Die `.vercel/`-Mappe liegt lokal und ist via `.gitignore` ausgeschlossen.

## Dependencies

Leaflet 1.9.4 ist **lokal vendored** unter `vendor/leaflet-1.9.4/` (CSS + JS). Kein CDN-Zugriff bei Leaflet. Bei einem Versionsupgrade: neue Dateien herunterladen und die Pfade in `index.html` anpassen.

## Project structure

```
weather-dashboard/
├── index.html
├── css/style.css
├── js/
│   ├── weather.js       # API + Geocoding
│   ├── map.js           # Leaflet map
│   ├── ui.js            # DOM rendering
│   ├── app.js           # Orchestration
│   └── config.js        # OWM API key (gitignored, lokal only)
├── vendor/leaflet-1.9.4/
├── Wetter Dashboard.vbs
└── Wetter Dashboard beenden.vbs
```

`config.js` enthält den OpenWeatherMap-Key für Cloud/Radar-Overlays. Die Datei ist gitignored und nicht auf Vercel — ohne sie fehlen nur die Overlay-Layer, das Dashboard funktioniert.

## Architecture

The app uses an **IIFE + `window.*` global namespace** pattern instead of ES modules. This is intentional: native `import/export` is blocked on `file://` protocol, and there is no bundler. Script load order in `index.html` is significant — `weather.js` → `map.js` → `ui.js` → `app.js`.

### Module responsibilities

| File | Responsibility |
|------|---------------|
| `js/weather.js` | Open-Meteo + Bright Sky API fetch, WMO code table, raw→internal data shape, geocoding, dynamic location state. Exposes `window.WeatherAPI` (`fetchWeather`, `fetchAlerts`, `describeWeather`, `geocode`, `setLocation`, `getLocation`, `DEFAULT_LOCATION`). |
| `js/map.js` | Leaflet map init (centred on Germany), marker, live popup update, fly-to animation on location change, OWM overlay layers, scale control. Exposes `window.WeatherMap` (`initMap`, `moveMarker`, `updateMarkerPopup`, `initMapExpand`). |
| `js/ui.js` | All DOM rendering: hero (incl. dynamic title), alerts section, sun arc, hourly strip/chart, daily grid, day detail panel. Exposes `window.WeatherUI`. |
| `js/app.js` | Orchestration: fetches weather + alerts in parallel via `Promise.allSettled`, wires refresh button and search form, 10-min auto-refresh with 30s debounce on tab-visibility, label updates on location change. |

### Data flow

`app.js` calls `WeatherAPI.fetchWeather()` + `WeatherAPI.fetchAlerts()` in parallel → weather data normalised to `{ location, units, current, daily, hourly, fetchedAt }` → passed to `WeatherUI.render*()` functions → alerts array passed to `WeatherUI.renderAlerts()` → `WeatherMap.updateMarkerPopup(current, locationName)` gets current + name.

### Key conventions

- **WMO codes**: `weather.js` maps all Open-Meteo WMO codes (0–99) to `{ label, icon }`. Adding a new code means adding one entry to the `WEATHER_CODES` object in that file.
- **Date parsing**: Open-Meteo returns unix timestamps (timeformat=unixtime). Bright Sky returns ISO strings — use `safeParseDate()` in `weather.js` for those, never `new Date(string)` directly.
- **Locale**: All formatting uses `de-DE` locale and `Europe/Berlin` timezone via `Intl.DateTimeFormat`. Note: timezone is hardcoded to `Europe/Berlin` in `ui.js` — times for non-German locations still display in Berlin time (known limitation).
- **Skeleton loading**: HTML includes `.skeleton-text` / `.skeleton-box` placeholder elements; `ui.js:removeSkeleton()` strips the class once real data arrives.
- **Sun arc SVG**: The arc is a fixed `viewBox="0 0 300 160"` semicircle path. The `#sun-dot` circle `cx/cy` is computed in `renderSun()` using trigonometry against the path's geometric centre `(150, 140)` with radius 130.
- **Hourly view toggle**: The hourly card has a segmented control (Kacheln / Chart) that switches between the tile strip (`#hourly-strip`) and an SVG temperature chart (`#hourly-chart`). Toggle is initialised once via `WeatherUI.initHourlyToggle()` in `app.js:init()`. Both views are re-rendered on every data fetch via `renderHourly(data)` and `renderTempChart(data)`. The chart uses a Catmull-Rom → cubic Bézier smooth curve, gradient fill, horizontal grid lines, temperature dot-labels every 3 h, and precipitation probability bars at the bottom.
- **DWD Alerts**: `#alerts-section` card (zwischen Hero und Map) wird nur eingeblendet wenn aktive Warnungen vorliegen. Severity-Whitelist: `minor | moderate | severe | extreme`. Die Hero-Pill (`#weather-alert`) wird bei aktiven DWD-Warnungen überschrieben. Bright Sky deckt nur Deutschland ab — für internationale Standorte bleibt die Alert-Card leer (nicht-kritischer Pfad).
- **Fetch-Robustheit**: Alle `fetch()`-Aufrufe gehen über `fetchWithTimeout(url, 15000)` mit `AbortController`. Bei fehlschlagendem Alert-Fetch zeigt das Dashboard weiterhin die Wetterdaten (nicht-kritischer Pfad via `Promise.allSettled`). Geocode-Fetch hat 10s Timeout.
- **CSP**: `style-src` ist in `style-src-elem 'self'` (für `<link>`/`<style>`) und `style-src-attr 'unsafe-inline'` (für Leaflet-interne JS-Styles) aufgeteilt. Kein `data:` in `img-src`. Kein CDN in `script-src`. `connect-src` enthält auch `https://geocoding-api.open-meteo.com`.
- **Karte maximieren**: `#map-expand-btn` (unten links auf der Karte, `z-index: 2`) togglet `.map-expanded` auf `.map-card` und `.map-row-expanded` auf `.row-two-col`. Das 2-Spalten-Grid wird dabei zu 1-Spaltig (Sun-Card rutscht darunter), `.map-wrap` wächst auf `65vh` (CSS-Transition 0.3s). `WeatherMap.initMapExpand()` wird einmalig in `app.js:init()` aufgerufen. Nach der Transition: `map.invalidateSize()` damit Leaflet die neue Größe erkennt.
- **Maßstab**: `L.control.scale({ position: 'bottomright', imperial: false })` — zeigt Meter/km-Maßstab unten rechts, aktualisiert sich automatisch beim Zoomen. CSS: weißer Text, dunkler Hintergrund, Akzentfarbe als Border.
- **RainViewer Radar**: `maxNativeZoom: 7` verhindert dass Leaflet Tiles bei Zoom ≥ 8 anfragt (RainViewer liefert dort Fehlerbilder). Leaflet skaliert stattdessen Zoom-7-Tiles hoch. **Nie** canvas-basierte Error-Tile-Erkennung verwenden — hat wegen CORS-Caching nie zuverlässig funktioniert. Zusätzlich: Pre-Flight-Probe (z=6,x=33,y=21) prüft Frame vor Aktivierung; Auto-Refresh alle 5 min hält Frame-URL frisch. Bei Zoom > 12 werden Overlays ausgeblendet (Toast) und bei Herauszoomen wiederhergestellt.
- **Standortsuche**: `WeatherAPI.geocode(query)` ruft die Open-Meteo Geocoding API auf (`geocoding-api.open-meteo.com/v1/search`), gibt bis zu 5 normalisierte Treffer zurück. `setLocation(loc)` aktualisiert `activeLocation` — alle folgenden `fetchWeather()`/`fetchAlerts()`-Calls nutzen automatisch die neuen Koordinaten. `app.js:updateLabels(loc)` synchronisiert Header-Subtitle, Seitentitel, Map-Card, Daily-Card und Alerts-Card. `WeatherMap.moveMarker(lat, lon, name)` fliegt den Marker mit `flyTo` (1.2s) zur neuen Position. Nürnberg bleibt `DEFAULT_LOCATION` beim initialen Laden. Input-Validierung: query max 100 Zeichen, Geocode-Ergebnis-Felder je auf 100 Zeichen begrenzt.

## Security & Datenschutz

- Leaflet ist lokal vendored — kein automatischer Drittlandtransfer an unpkg.com/Cloudflare
- Externe API-Calls: Open-Meteo DE (Wetter + Geocoding), Bright Sky DE, OSM UK (EU-Angemessenheitsbeschluss)
- Privacy-Notice im Footer deckt DSGVO Art. 13-Informationspflicht ab
- Severity-Felder der Bright Sky API werden via Whitelist validiert; Texte sind auf 100–2000 Zeichen begrenzt
- Geocoding-Eingabe: query trimmed + max 100 Zeichen, Ergebnisfelder je auf 60–100 Zeichen begrenzt, kein innerHTML — ausschließlich `textContent`
