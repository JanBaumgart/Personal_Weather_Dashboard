# Weather Dashboard — Nürnberg

A static, zero-dependency weather dashboard for Nuremberg, Germany.  
Opens directly in a browser — no build step, no server, no npm required.

## Features

- Current conditions: temperature, feels-like, wind, humidity, UV index, precipitation
- Interactive map of Germany with a Nuremberg marker (Leaflet + OpenStreetMap)
- 7-day forecast
- Hourly forecast strip (next 24 h)
- Sunrise / sunset arc with live sun position
- Dark modern UI, fully responsive
- Auto-refreshes every 10 minutes

## Usage

1. Clone or download the repository
2. Open `index.html` in any modern browser

No API key needed. Data is fetched from the free [Open-Meteo](https://open-meteo.com) API.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Markup | Vanilla HTML5 |
| Styles | Vanilla CSS (custom properties, CSS Grid) |
| Logic | Vanilla JS (ES2020, IIFE modules) |
| Weather data | [Open-Meteo API](https://open-meteo.com) (free, no key) |
| Map | [Leaflet 1.9.4](https://leafletjs.com) via CDN (SRI-pinned) |
| Tiles | [OpenStreetMap](https://www.openstreetmap.org/copyright) |

## Privacy

When this page is loaded, the following third-party services are contacted automatically:

| Service | Purpose | Data transmitted |
|---------|---------|-----------------|
| `unpkg.com` (Cloudflare, USA) | Loads the Leaflet library | IP address, User-Agent, browser headers |
| `api.open-meteo.com` (Open-Meteo, DE) | Fetches weather data | IP address, User-Agent |
| `*.tile.openstreetmap.org` (OSMF, UK) | Loads map tiles | IP address, User-Agent, tile coordinates |

No cookies are set. No data is stored locally (`localStorage`, `sessionStorage`, `IndexedDB`). No user tracking or profiling takes place. The coordinates sent to Open-Meteo are hardcoded (Nuremberg 49.45° N, 11.08° E) and do not reflect the visitor's location.

## License

MIT — see [LICENSE](LICENSE).

### Third-party licenses

- **Leaflet** — [BSD 2-Clause](https://github.com/Leaflet/Leaflet/blob/main/LICENSE)
- **OpenStreetMap data** — [ODbL](https://www.openstreetmap.org/copyright)
- **Open-Meteo** — [CC BY 4.0](https://open-meteo.com/en/terms)
