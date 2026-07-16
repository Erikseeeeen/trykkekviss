# Trykkekviss

A minimal Cloudflare Pages quiz for two question types:

- `map-location`: players click a locked Leaflet/OpenStreetMap view; answers are scored by distance in kilometres.
- `fibbage`: joined players first submit believable lies, then vote among the true answer and the submitted player lies.

Fibbage scoring is intentionally simple: choosing the truth gives 1000 points, and every player fooled by your lie gives you 500 points.

## Local development

```bash
npm install
npm run dev
```

The app expects a Cloudflare D1 binding called `DB`. The API creates its tables automatically, and the schema is also kept in `schema.sql`.

For local development without an admin password, leave `ADMIN_KEY` unset. In production, set `ADMIN_KEY` as a Cloudflare Pages environment variable and enter the same value in the admin screen.

## First quiz

1. Open `/admin.html`.
2. Use quiz slug `kreta`.
3. Press `Seed sample` to add the built-in Kreta question set, or create questions manually.
4. For a map question, choose `Map`, set the center/zoom/tolerance, click the correct location, and save.
5. For a Fibbage question, choose `Fibbage`, enter the true answer, and save.
6. During a Fibbage round, players press `Join`, the presenter presses `Open`, and the room automatically moves to voting when all joined players have submitted a lie.
7. Press `Reveal` for truth and scores. The presenter can still press `Vote` as a manual override if someone should be skipped.

Map questions use local vendored Leaflet assets, but still fetch OpenStreetMap tiles, so the presenter and players need internet access for those maps to render.
