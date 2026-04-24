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
├── api/
│   └── owm-key.js       # Vercel Serverless Function — liefert OWM_API_KEY aus Env Var
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

`config.js` enthält den OpenWeatherMap-Key lokal (gitignored). Auf Vercel wird der Key über `api/owm-key.js` als Env Var `OWM_API_KEY` bereitgestellt. `map.js:initCloudLayer()` prüft zuerst `window.WD_CONFIG` (lokal), fetcht sonst von `/api/owm-key` (Produktion, `Cache-Control: private, no-store`). Ohne Key wird der Cloud-Button ausgeblendet.

## Architecture

The app uses an **IIFE + `window.*` global namespace** pattern instead of ES modules. This is intentional: native `import/export` is blocked on `file://` protocol, and there is no bundler. Script load order in `index.html` is significant — `weather.js` → `map.js` → `ui.js` → `app.js`.

### Module responsibilities

| File | Responsibility |
|------|---------------|
| `js/weather.js` | Open-Meteo + Bright Sky API fetch, WMO code table, raw→internal data shape, geocoding, dynamic location state. Exposes `window.WeatherAPI` (`fetchWeather`, `fetchCurrentForLoc`, `fetchAlerts`, `describeWeather`, `geocode`, `setLocation`, `getLocation`, `DEFAULT_LOCATION`). |
| `js/map.js` | Leaflet map init (centred on Germany), marker, live popup update, fly-to animation on location change, OWM overlay layers, scale control, fav markers. Exposes `window.WeatherMap` (`initMap`, `moveMarker`, `updateMarkerPopup`, `initMapExpand`, `setFavMarkers`, `setRadarFrame`, `resetRadarFrame`, `initAnimation`, `initCloudLayer`, `initRadarLayer`). |
| `js/ui.js` | All DOM rendering: hero (incl. dynamic title), alerts section, sun arc, hourly strip/chart, daily grid, day detail panel. Exposes `window.WeatherUI`. |
| `js/app.js` | Orchestration: fetches weather + alerts in parallel via `Promise.allSettled`, wires refresh button and search form, 10-min auto-refresh with 30s debounce on tab-visibility, label updates on location change. |

### Data flow

`app.js` calls `WeatherAPI.fetchWeather()` + `WeatherAPI.fetchAlerts()` in parallel → weather data normalised to `{ location, units, current, daily, hourly, fetchedAt }` → passed to `WeatherUI.render*()` functions → alerts array passed to `WeatherUI.renderAlerts()` → `WeatherMap.updateMarkerPopup(current, locationName)` gets current + name.

### Key conventions

- **WMO codes**: `weather.js` maps all Open-Meteo WMO codes (0–99) to `{ label, icon }`. Adding a new code means adding one entry to the `WEATHER_CODES` object in that file.
- **Date parsing**: Open-Meteo returns unix timestamps (timeformat=unixtime). Bright Sky returns ISO strings — use `safeParseDate()` in `weather.js` for those, never `new Date(string)` directly.
- **Locale / Dynamische Zeitzone**: Formatting nutzt `de-DE` locale. Timezone ist dynamisch pro Standort. `WeatherUI.setTimezone(tz)` rebuildet alle `Intl.DateTimeFormat`-Instanzen in `ui.js`; `WeatherMap.setTimezone(tz)` rebuildet `_timeOverlayFmt` in `map.js` (Radar-Zeit-Overlay). `app.js` ruft beide bei jedem Standortwechsel auf: `pickLocation()`, Deep-Link-Init, Last-Location-Init. Timezone kommt aus Geocoding-Ergebnis (Open-Meteo) oder Nominatim-Flow (Open-Meteo `timezone=auto`).
- **Skeleton loading**: HTML includes `.skeleton-text` / `.skeleton-box` placeholder elements; `ui.js:removeSkeleton()` strips the class once real data arrives.
- **Sun arc SVG**: The arc is a fixed `viewBox="0 0 300 160"` semicircle path. The `#sun-dot` circle `cx/cy` is computed in `renderSun()` using trigonometry against the path's geometric centre `(150, 140)` with radius 130.
- **Hourly view toggle**: The hourly card has a segmented control (Kacheln / Chart) that switches between the tile strip (`#hourly-strip`) and an SVG temperature chart (`#hourly-chart`). Toggle is initialised once via `WeatherUI.initHourlyToggle()` in `app.js:init()`. Both views are re-rendered on every data fetch via `renderHourly(data)` and `renderTempChart(data)`. The chart uses a Catmull-Rom → cubic Bézier smooth curve, gradient fill, horizontal grid lines, temperature dot-labels every 3 h, and precipitation probability bars at the bottom.
- **DWD Alerts**: `#alerts-section` card (zwischen Hero und Map) wird nur eingeblendet wenn aktive Warnungen vorliegen. Severity-Whitelist: `minor | moderate | severe | extreme`. Die Hero-Pill (`#weather-alert`) wird bei aktiven DWD-Warnungen überschrieben. Bright Sky deckt nur Deutschland ab — für internationale Standorte bleibt die Alert-Card leer (nicht-kritischer Pfad).
- **Fetch-Robustheit**: Alle `fetch()`-Aufrufe gehen über `fetchWithTimeout(url, 15000)` mit `AbortController`. Bei fehlschlagendem Alert-Fetch zeigt das Dashboard weiterhin die Wetterdaten (nicht-kritischer Pfad via `Promise.allSettled`). Geocode-Fetch hat 10s Timeout.
- **CSP**: `style-src` ist in `style-src-elem 'self'` (für `<link>`/`<style>`) und `style-src-attr 'unsafe-inline'` (für Leaflet-interne JS-Styles) aufgeteilt. `img-src` enthält `data:` — wird von `map.js:TRANSPARENT_PX` (1x1-GIF als Fallback für fehlgeschlagene Radar-Tiles im `tileerror`-Handler) benötigt. Kein CDN in `script-src`. `connect-src` enthält auch `https://geocoding-api.open-meteo.com`.
- **Karte maximieren**: `#map-expand-btn` (unten links auf der Karte, `z-index: 2`) togglet `.map-expanded` auf `.map-card` und `.map-row-expanded` auf `.row-two-col`. Das 2-Spalten-Grid wird dabei zu 1-Spaltig (Sun-Card rutscht darunter), `.map-wrap` wächst auf `65vh` (CSS-Transition 0.3s). `WeatherMap.initMapExpand()` wird einmalig in `app.js:init()` aufgerufen. Nach der Transition: `map.invalidateSize()` damit Leaflet die neue Größe erkennt.
- **Maßstab**: `L.control.scale({ position: 'bottomright', imperial: false })` — zeigt Meter/km-Maßstab unten rechts, aktualisiert sich automatisch beim Zoomen. CSS: weißer Text, dunkler Hintergrund, Akzentfarbe als Border.
- **RainViewer Radar**: `maxNativeZoom: 7` verhindert dass Leaflet Tiles bei Zoom ≥ 8 anfragt (RainViewer liefert dort Fehlerbilder „Zoom Level Not Supported"). Leaflet skaliert stattdessen Zoom-7-Tiles hoch — das ist der einzig zuverlässige Fix. **Nie** canvas-basierte Error-Tile-Erkennung (`getImageData`) verwenden — schlägt wegen CORS-Caching-Inkonsistenzen immer wieder fehl, egal wie die Heuristik tuned wird. Pre-Flight-Probe (z=6,x=33,y=21) prüft Frame vor Aktivierung; Auto-Refresh alle 5 min (`RADAR_REFRESH_MS`) hält Frame-URL frisch; nach 5 aufeinanderfolgenden Refresh-Fehlern stoppt der Timer (`_refreshFailCount`). `data.host` aus der RainViewer API wird gegen Whitelist-Regex validiert bevor URLs konstruiert werden. Bei Zoom > 12 werden Overlays ausgeblendet (Toast „Wetter-Overlays bei dieser Zoomstufe ausgeblendet") und bei Herauszoomen wiederhergestellt.
- **Standortsuche**: `WeatherAPI.geocode(query)` ruft die Open-Meteo Geocoding API auf (`geocoding-api.open-meteo.com/v1/search`), gibt bis zu 5 normalisierte Treffer zurück. `setLocation(loc)` aktualisiert `activeLocation` — alle folgenden `fetchWeather()`/`fetchAlerts()`-Calls nutzen automatisch die neuen Koordinaten. `app.js:updateLabels(loc)` synchronisiert Header-Subtitle, Seitentitel, Map-Card, Daily-Card und Alerts-Card. `WeatherMap.moveMarker(lat, lon, name)` fliegt den Marker mit `flyTo` (1.2s) zur neuen Position. Nürnberg bleibt `DEFAULT_LOCATION` beim initialen Laden. Input-Validierung: query max 100 Zeichen, Geocode-Ergebnis-Felder je auf 100 Zeichen begrenzt.
- **Niederschlags-Timing-Chip** (`#rain-timing`): Zweiter Pill-Badge im Hero, direkt neben `#weather-alert`, beide in `.alert-row` (flex, wrap, gap 8px). Logik in `ui.js`: `findPrecipTiming(hourly, currentCode, currentPrecipMm)` scannt die nächsten 12 h der stündlichen Daten. **Drei-Signal-Logik**: (1) "Regnet es jetzt?" → WMO-Code muss Niederschlag anzeigen UND `current.precipitation ≥ 0.1 mm` (gemessene mm — verhindert stale Codes nach Regenende). (2) "Wann fängt es an?" → Wenn `precipitationProbability` verfügbar ist (immer bei Open-Meteo), wird ausschließlich `prob ≥ 40 %` als Gate verwendet — WMO-Code allein reicht nicht. Fällt `precipitationProbability` aus der API weg, wird als Fallback der WMO-Code genutzt. Regnet es gerade → zeigt `🌧️ noch ~X Std.`; sonst → `🕐 in ~X Min./Std.`. Kein Niederschlag in 12 h → `hidden`. Farbklassen: `rain`/`snow`/`storm`. `formatDuration(ms)`: < 60 min → Minuten, sonst gerundete Stunden. **CSS-Pitfall**: `.weather-alert` hat `display: inline-flex` — das überschreibt das native `[hidden]`-Attribut. Fix: `.weather-alert[hidden] { display: none; }` vor der Klassen-Regel.
- **Favoriten-Standorte**: `app.js` verwaltet bis zu 8 Favoriten in `localStorage` (Key: `weather_favorites`), gespeichert als JSON-Array `{name, country, lat, lon, timezone, displayName}`, alphabetisch nach Name sortiert. API: `loadFavorites()`, `addFavorite(loc)`, `removeFavorite(loc)`, `isFavorite(loc)`, `toggleFavorite(loc)` (gibt bool zurück). Duplikat-Erkennung per lat/lon-Nähe (< 0.01°). UI: (1) ☆/★-Button (`#subtitle-fav-btn`, `.fav-star-btn`) neben dem Subtitle im Header — toggelt aktuellen Standort; wird bei `pickLocation` + `init` via `updateSubtitleStar()` aktualisiert. (2) Jedes Suchergebnis (`_buildSuggestionItem`) hat einen `.suggestion-star`-Button rechts — Klick toggelt Favorit ohne die Liste zu schließen; bei Entfernen aus dem Favoriten-Dropdown wird die Liste sofort neu gerendert. (3) Suchfeld fokussieren (leer) → `showFavoritesDropdown()` zeigt Favoriten-Liste mit "Favoriten"-Header. Suggestion-Items sind jetzt flex (`display: flex`) mit `.suggestion-name` (flex:1, text-overflow) und `.suggestion-star` (fixed, flex-shrink:0). `showSearchStatus` bleibt unverändert (kein Stern).
- **Stündliche Zeitreise** (Time-Peek): Klick auf eine Kachel im Stundenstreifen oder einen Spaltenpunkt im Temp-Chart aktiviert einen "Time-Peek"-Modus. Hero (Temp, Icon, Beschreibung, alle Stats), Weather-Alert-Chip und Subtitle (`"15:00 Uhr · Nürnberg, DE"`) zeigen dann die Daten dieser Stunde. Regen-Timing-Pill wird ausgeblendet (wäre zu "jetzt" relativ). Erneutes Klicken auf dieselbe Kachel setzt alles zurück auf Live. Auto-Refresh (alle 10 Min.) setzt die Auswahl ebenfalls zurück. State wird in `_activeHourTs` (ms-Timestamp) in `ui.js` gehalten. `renderHeroForHour(h, data)` rendert den Hero für einen Stunden-Entry; `_restoreLiveHero()` stellt den Originalzustand wieder her. Hoch/Tief kommt aus dem Daily-Datensatz des betreffenden Kalendertags. Implementierung: `initHourlyMapClick()` hängt delegierte Click-Listener an `#hourly-strip` und `#hourly-chart` (einmalig, Guard via `_mapClickAttached`).
- **Radar-Frame-Scrubbing**: Gleichzeitig mit dem Time-Peek wird auf der Karte der zeitlich nächste RainViewer-Frame angezeigt. Verfügbares Fenster: ca. ±100 Minuten (Vergangenheit + Nowcast). Liegt die gewählte Stunde außerhalb → Toast "Keine Radardaten für diese Zeit verfügbar". OWM-Cloud-Layer und -Button werden bei aktivem Frame ausgeblendet und bei Reset wiederhergestellt. State in `map.js`: `_framePinned`, `_allFrames`, `_liveFramePath`, `_currentHost`, `_cloudHiddenForFrame`. Öffentliche API: `WeatherMap.setRadarFrame(msTimestamp)` → bool, `WeatherMap.resetRadarFrame()`.
- **Radar-Animation** (nur im maximierten Kartenzustand): Button "▶ Abspielen" erscheint unten-mitte auf der Karte wenn `.map-expanded` aktiv ist (CSS `display:none` → `display:flex`). Animiert alle RainViewer-Frames (past + nowcast, typisch ~15 Frames) mit 1 Sek./Frame. Zeit-Overlay (`div.map-time-overlay`, top-center der Karte) zeigt `"HH:mm Uhr"` für Vergangenheits-Frames und `"HH:mm Uhr · Prognose"` (gelb, `.map-time-overlay--nowcast`) für Nowcast-Frames (`_animIdx > _pastFrameCount`). `initAnimation()` erstellt den Button einmalig; `_startAnimation()` / `_stopAnimation()` steuern den Ablauf. Nach Animation-Ende automatischer Reset auf Live-Frame.
- **Niederschlagsbalken im Chart**: Die Balken liegen jetzt **innerhalb** der Temperaturkurve (nicht am unteren Rand), wachsen von unten nach oben proportional zur Wahrscheinlichkeit (max. volle Plotfläche = 100 %). Opacity `rgba(56,189,248,0.13)` — subtil hinter der Kurve. Aktive Spalte erhält halbtransparenten teal-Highlight-Rect (unter allen anderen Elementen). Invisible Hit-Rects (`data-hour-ts`) über die gesamte Chart-Höhe ermöglichen Klick auf jede Stunden-Spalte.
- **Stündliche Felder (erweitert)**: `weather.js:buildApiUrl` holt stündlich `apparent_temperature, wind_speed_10m, wind_direction_10m, relative_humidity_2m, uv_index, precipitation, precipitation_probability, weather_code`. Current-Payload enthält außerdem `wind_direction_10m`. Alle Felder in jedem Hourly-Objekt: `apparent`, `windSpeed`, `windDirection`, `humidity`, `uvIndex`, `precipitation`, `precipitationProbability` (null wenn nicht geliefert).
- **Wind / UV im Hero**: `ui.js` berechnet aus `c.windDirection` (°) einen 8-Punkt-Richtungspfeil (↑↗→↘↓↙←↖, zeigt Windrichtung wohin) + Kompass-Kürzel (N/NO/O/SO/S/SW/W/NW). `beaufort(kmh)` liefert Bft-Zahl (0–12). Anzeige in `#stat-wind` + `#stat-wind-meta` (z.B. `↗ 24 km/h` / `Bft 5 · SW`). UV-Risiko-Label (`uvRisk(idx)`) zeigt Niedrig/Mittel/Hoch/Sehr hoch/Extrem in `#stat-uv-meta`. Beide Meta-Spans sind neue HTML-Elemente mit CSS-Klasse `.stat-meta`.
- **URL Deep-Link**: `app.js:init()` liest `URLSearchParams` (`?lat=&lon=&name=&country=&timezone=`). Wenn lat/lon gültig (bounds-check) und name nicht leer → `WeatherAPI.setLocation()` vor Map-Init, sodass Karte direkt zentriert öffnet. Beispiel: `?lat=48.137&lon=11.576&name=München&country=DE&timezone=Europe/Berlin`. Kein Backend nötig, kein API-Layer-Eingriff.
- **Favoriten-Marker auf der Karte**: `map.js:setFavMarkers(favorites, weatherMap)` rendert Amber-Marker (28×28 px, Gradient #fbbf24→#f97316, `.fav-marker`) für alle Favoriten. Aktiver Standort wird übersprungen (< 0.01° Abstand). Klick dispatcht Custom-Event `wd:pick-location` → `app.js:pickLocation()`. `app.js:_syncFavMarkers()` ist async und fetcht parallel für jeden Favoriten per `WeatherAPI.fetchCurrentForLoc(fav)` (nur `temperature_2m,weather_code`, kein Side-Effect auf `activeLocation`). Das Marker-Icon zeigt das Wetter-Emoji; der Tooltip zeigt Name + `⛅ 18° · Teils bewölkt`. Sync wird aufgerufen bei: `init()`, jedem `loadAndRender()` (fire-and-forget), `pickLocation()`, Stern-Toggle. `weather.js:fetchCurrentForLoc(loc)` ist der neue lightweight Fetch für beliebige Koordinaten ohne State-Mutation.
- **Browser-Geolokalisierung**: `#gps-btn` (Crosshair-Icon, `.search-btn.gps-btn`) in `#search-form` direkt nach `#search-btn`. `app.js:useMyLocation()` (async): `navigator.geolocation.getCurrentPosition()` → lat/lon → `WeatherAPI.reverseGeocode(lat, lon)` → `pickLocation()`. Guard: wenn `navigator.geolocation` nicht verfügbar, wird Button ausgeblendet. Fehlerbehandlung: `PositionError.code 1` = Zugriff verweigert, `3` = Timeout — Meldung via `showSearchStatus()`. `weather.js:reverseGeocode(lat, lon)` ruft parallel Nominatim (`nominatim.openstreetmap.org/reverse`, 5s Timeout) + Open-Meteo (`timezone=auto`, 5s Timeout) via `Promise.allSettled` auf; Fallback: `name='Mein Standort'`, `country=''`, `timezone='UTC'`. Button: `disabled` + `.loading`-Klasse während des Fetches (CSS spin-Animation via `.search-btn.loading svg`).


## Feature-Roadmap (Stand 22. Apr 2026)

Aus Idea Pitch.html im Projektroot. Priorität: #1 → #2 → #3.

### #1 Dynamische Zeitzone je Standort — FERTIG ✓
`WeatherMap.setTimezone(tz)` in `map.js` rebuildet `_timeOverlayFmt`. Wird in `app.js` parallel zu `WeatherUI.setTimezone(tz)` an allen 3 Stellen aufgerufen.

### #2 Browser-Geolokalisierung — FERTIG ✓
GPS-Button (`#gps-btn`) in Suchleiste. `app.js:useMyLocation()` → Nominatim + Open-Meteo timezone=auto → `pickLocation()`. `vercel.json` Permissions-Policy auf `geolocation=(self)`. CSP + Privacy-Notice aktualisiert.

### #3 Luftqualität (AQI) — FERTIG ✓
`air-quality-api.open-meteo.com/v1/air-quality` (kein Key). `weather.js:fetchAqi()` parallel in `app.js` via `Promise.allSettled`. Map-Toggle-Button (`#map-aqi-btn`, bottom: 140px links) aktiviert `L.circleMarker` am aktuellen Standort + `.map-aqi-overlay` (bottom-right) + `#aqi-card` (nach `#day-detail`) mit `#aqi-current` (EAQI-Wert + PM2.5/PM10/Ozon) und `#aqi-chart` (SVG-Balkendiagramm nächste 24h, farbcodiert nach EAQI-Stufe). Hero-Badge (`#aqi-badge`) nur bei EAQI ≥ 60. CSP + Privacy-Notice angepasst.

## Security & Datenschutz

- Leaflet ist lokal vendored — kein automatischer Drittlandtransfer an unpkg.com/Cloudflare
- Externe API-Calls: Open-Meteo DE (Wetter + Geocoding), Bright Sky DE, OSM UK, RainViewer LV, OpenWeatherMap UK (alle EU-Angemessenheitsbeschluss oder EU-ansässig)
- Privacy-Notice im Footer deckt DSGVO Art. 13-Informationspflicht ab (Open-Meteo, Bright Sky/DWD, OSM, RainViewer, OWM — inkl. Hinweis dass OWM-Transfer nur bei aktiviertem Cloud-Overlay stattfindet)
- Severity-Felder der Bright Sky API werden via Whitelist validiert; Texte sind auf 100–2000 Zeichen begrenzt
- Geocoding-Eingabe: query trimmed + max 100 Zeichen, Ergebnisfelder je auf 60–100 Zeichen begrenzt, kein innerHTML — ausschließlich `textContent`
- RainViewer `data.host` wird via Regex gegen `tilecache.rainviewer.com` validiert bevor URLs gebaut werden
- OWM API Key: lokal in `js/config.js` (gitignored), auf Vercel als Env Var `OWM_API_KEY` über `api/owm-key.js` bereitgestellt. Key nie im Git-Repo. Der Key ist in OWM-Tile-Request-URLs im Browser-Netzwerk sichtbar — das ist bei direkten Tile-Requests unvermeidbar. OWM HTTP-Referrer-Restriction ist auf Free-Plan nicht verfügbar.
- CSP in `index.html`: `img-src` enthält `tilecache.rainviewer.com`, `connect-src` enthält `api.rainviewer.com` und `nominatim.openstreetmap.org` (für GPS Reverse-Geocoding) — korrekt gesetzt
- `vercel.json` Permissions-Policy: `geolocation=(self)` — erlaubt GPS nur von eigener Origin; fremde iframes haben keinen Zugriff
