# Swimmable

Is the sea good today? The app answers in one word, *Go*, *Sketchy*, or *No*, and it answers twice: once for open-water swimming and once for freediving. Those two answers disagree more often than you'd expect.

Every marine forecast I could find shows a table of numbers and leaves the interpretation to you. That's fine if you already know a 0.4 m wind chop ruins a training swim while a 0.4 m long-period swell doesn't. Most people don't. Swimmable does the interpreting.

> **Live:** _deploying_
> **Stack:** vanilla JS, Vite, MapLibre GL, PWA, Vitest
> **Data:** [Open-Meteo](https://open-meteo.com) Marine and Forecast APIs. No key, no backend, no tracking.

---

## What it does

Two verdicts rather than one, because the same water means opposite things to the two activities. Long-period swell rolls through smoothly for a swimmer, and the very same swell creates surge at depth for a freediver. The signal inverts.

It also knows which way the wind is blowing relative to the shore. Offshore wind grooms the surface flat and an onshore wind at identical speed wrecks it, so a single wind number tells you almost nothing on its own.

When Open-Meteo's wave model has no data for a spot, the app says *Unknown* rather than guessing. There's a story behind that one, below.

Beyond the verdict it finds your best window, meaning the longest run of consecutive good hours for that activity on that day, and it will explain itself if you tap a card: which factor is holding you back, what the water temperature is, how hard it's gusting. It installs as a PWA and works offline, and saved spots live in local storage.

## The interesting part: the scoring model

The whole app is a thin shell around `src/forecast/score.js`. Three decisions in there are worth reading.

**Wind is a modifier, not a weighted term.** The first version scored `wave·0.40 + chop·0.30 + wind·0.30`. That turns out to be physically wrong. Open-Meteo *derives* `wind_wave_height` from the wind field, so chop and wind aren't independent variables at all, and 60% of the verdict was one physical cause counted twice. The app called every breezy afternoon unswimmable. Wind now contributes only what chop can't express: direction, gustiness, drift hazard. Written up in [ADR 0002](docs/adr/0002-additive-scoring-model.md).

**Safety is a cap, not a penalty.** A 38 km/h offshore khamsin flattens the sea, so the sea-state score comes out excellent, and that same wind will blow a stationary freediver out to sea. No additive penalty can honestly drag that below Go, because the water genuinely is beautiful. So comfort accumulates additively and hazards impose ceilings. Cold-shock water below 13 °C works the same way.

**The shoreline is inferred, not known.** Deciding onshore from offshore requires knowing which way the coast faces, and the app can't know that for a pin dropped anywhere on a map. Swell is generated far out at sea and travels shoreward, so the bearing that waves arrive *from* approximates the seaward direction. It's a heuristic, it has a documented failure mode in enclosed bays where the local sea is wind-driven, and it beats ignoring direction the way the first version did.

## Domain notes

Some of what the model encodes isn't obvious unless you spend time in the water.

*Significant wave height* is the mean of the highest third of waves. Roughly 15% of waves exceed it and the largest may be about twice it. It's the only raw number the app puts on screen, because experienced swimmers already reason in it.

*Chop* is short-period and locally wind-generated. *Swell* is long-period and organised. A choppy 0.4 m sea is much harder work than a swelly 0.4 m sea, which is why chop carries more weight than swell for both activities.

*Surge* is the back-and-forth underwater movement driven by wave period, felt down to roughly T²/4 metres. A 15-second swell can look like glass from the beach and still throw you around at 25 m. It's the one hazard the surface doesn't advertise, so the app always mentions it for freediving.

*Gust factor* is gusts divided by mean wind. Past about 1.5 the wind is squally, which is unpleasant in ways that mean speed doesn't capture.

The full glossary lives in [CONTEXT.md](CONTEXT.md).

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 54 tests
npm run build    # → dist/
```

No API keys and no environment variables. Both Open-Meteo endpoints are open.

## Architecture

```
src/
├── forecast/
│   ├── score.js        ← the whole domain model lives here
│   └── openmeteo.js    ← fetch, merge two APIs, day bucketing, timezones
├── location/           ← GPS, geocoding, search
├── ui/                 ← render layer, one module per component
├── storage/local.js    ← saved spots
└── state.js            ← tiny pub/sub store
```

There's no framework on purpose. The app is a handful of pure functions and some direct DOM updates, and a render layer would have been more code than the thing it renders. MapLibre weighs 800 KB and is dynamically imported the first time the Map tab opens, which keeps the initial load near 10 KB gzipped.

## Testing

```
src/forecast/score.test.js   34 tests — the scoring model in isolation
src/ui/render.test.js        20 tests — render layer against the real index.html in jsdom
```

The split is deliberate. Every bug that actually reached a user in this app was a wiring bug: an element id renamed in one place but not the other, a CSS custom property deleted while three files still referenced it, a function whose signature changed under its caller. Pure-function tests are blind to all of those, so the integration suite mounts the shipped markup and renders into it.

Several tests are named regressions, each pinning a bug that shipped:

- Wind double-counting, so a 20 km/h breeze over a small sea has to stay swimmable
- A dead branch in the surge-depth calculation: the guard had already proved `period > 12`, then the ternary branched on `period <= 8`, so it printed "56 m" no matter what the swell was doing
- Go windows that required *both* activities to be Go, which reported nothing at all on a flawless swimming day that happened to be surge-y for freediving
- A step-function discontinuity where 0.249 m scored 100 and 0.251 m scored 85, so the hourly strip flickered between verdicts on physically identical water
- Browser-timezone parsing: Open-Meteo returns spot-local times with no offset, and `new Date()` reads those in the *user's* timezone, so checking a foreign spot gave you the wrong hour

## The bug the tests couldn't find

This one is worth calling out, because it turned up by pointing the scorer at the live API instead of at fixtures.

Open-Meteo's marine model doesn't resolve the Gulf of Aqaba. For Eilat, which is Israel's busiest freediving destination, every marine variable comes back `null` inside a perfectly well-formed 200 response. The merge layer mapped null to `0`, and `0` is indistinguishable from a genuine reading of flat calm water:

```
Eilat — SWIM Go (89), DIVE Go (89)
```

Maximum confidence about a place the app knew nothing about, at exactly the spot its users are most likely to be diving. Every test passed the whole time, because every fixture I had written contained marine data.

The fix is the *Unknown* verdict, written up in [ADR 0003](docs/adr/0003-unknown-verdict.md). The lesson is that a suite built from fixtures can only check the shapes you already thought of.

## Roadmap

- [ ] Live cam links per spot
- [ ] Morning briefing push notification at 6am for saved spots
- [ ] Improvement alerts when a spot flips to Go
- [ ] Tide and current where the model covers it
- [ ] Calibrate thresholds against logged sessions instead of judgement

## Licence

MIT
