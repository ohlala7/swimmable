# ADR 0003 · A Fourth Verdict: Unknown

**Status:** Accepted
**Amends:** ADR 0001, which defined three Verdicts

## Decision

Add a fourth Verdict, *Unknown*, returned when the marine model has no coverage for the requested location. It carries `score: null` and never counts toward a Go Window.

## Context

This came out of running the scorer against the live API instead of against fixtures.

Open-Meteo's marine model does not resolve small enclosed basins. Eilat sits on the Gulf of Aqaba and is Israel's busiest freediving destination, and every marine variable for it returns `null`. The API does not error. It returns a well-formed 200 response that happens to be full of nulls.

The merge layer mapped those nulls to `0`. A reading of `0` is indistinguishable from genuinely flat calm water, so the app produced this:

```
Eilat · SWIM Go (89), DIVE Go (89)
       "Onshore wind at 21 km/h stacking up the shorebreak."
```

Maximum confidence about a location it had no data for, at the one spot its users are most likely to be diving. The summary sentence even sounds authoritative, because the wind data was real. Only the water was invented.

Every unit test passed throughout. All the fixtures contained marine data, so nothing in the suite could see it.

## Why not a safer default

*Default to No.* Also a lie, just a conservative one. Someone who checks Eilat daily and always sees No concludes the app is broken, stops opening it, and stops seeing the real No days at every other spot too.

*Fall back to a nearby covered grid point.* The nearest covered water to Eilat belongs to a different body of water. Confidently wrong is the failure being fixed here, not a fix for it.

*Hide unsupported spots at search time.* Tempting, but coverage is only discoverable by requesting a forecast, and it varies by variable and by hour. It would also quietly delete places people want, giving them no idea why.

## Detection

`hasMarineData(hour)` tests whether `wave_height` is non-null. Wave height is the load-bearing input. Without it there is no sea state and everything downstream is guesswork, and wind alone is not enough to judge water.

This is narrower than "any field is null", deliberately. A real forecast with a gap in one secondary variable should still get scored. `normalizeHour` fills those gaps, and it now runs only once coverage has been confirmed.

## Consequences

Both scoring functions may now return `score: null`, so every consumer has to handle it. Verdict rank maps place Unknown below No, which means an hour the app cannot judge never appears better than one it judged and rejected.

`findBestWindow` skips Unknown hours, so an uncovered spot reports no window rather than a spurious all-day one.

The UI renders Unknown as a dashed, uncoloured card with no ambient tint, and draws no factor bars at all. With every cost sitting at zero those bars would render full, which reads as "nothing is holding you back". That is the exact false confidence this decision exists to prevent.

The summary tells the user what to do instead: *"No marine forecast covers this spot. Check locally before you get in."*
