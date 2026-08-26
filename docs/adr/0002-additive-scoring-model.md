# ADR 0002 · Additive Scoring, and Wind as a Modifier

**Status:** Accepted
**Supersedes:** the weighted-sum model in the original `score.js`

## Decision

Score an hour as a sea-state base plus signed adjustments, rather than as a weighted sum of independent components:

```
score = seaState(swell, chop) + windAdjustment(...) + periodAdjustment(...)
```

Wind stops being a weighted term. It becomes a modifier that can push the score either way.

## Context

The original model was `swimming = wave · 0.40 + chop · 0.30 + wind · 0.30`.

There is a physical error buried in that line. Open-Meteo computes `wind_wave_height`, which this app calls Chop, from the wind field. Chop is not an independent variable, it is the sea's response to wind, so scoring both at 30% meant 60% of the verdict came from one cause applied twice.

The symptom was easy to feel and hard to place. Every breezy day came back pessimistic. A 20 km/h afternoon sea breeze over a small sea got penalised through the chop term and then again through the wind term, and the app returned No for water that was entirely swimmable.

There was a second problem, and it was bigger. The model had no concept of wind direction at all. An offshore wind grooms the surface flat. An onshore wind at exactly the same speed stacks up a messy shorebreak and stirs the sediment. The original scoring could not tell those apart, which for anyone entering from the beach is the most important thing about the wind.

## What wind contributes that chop does not

Three things, and only these three:

- Direction, meaning offshore flattens, onshore roughens, and strong offshore becomes a drift hazard
- Gustiness, computed as `windgusts_10m / windspeed_10m`. This variable was already being fetched and then thrown away
- A small residual strength penalty, kept deliberately small because chop already carries most of it

## Inferring the shoreline

Onshore versus offshore requires knowing which way the coast faces. The app cannot know that for a pin dropped at an arbitrary point on a map.

So it infers. Swell is generated far out at sea and travels toward land, which means the bearing waves arrive from is a decent proxy for the seaward direction. Wind arriving from a similar bearing is blowing shoreward. Wind from the opposite bearing is blowing out to sea.

The failure mode is known and worth stating: inside enclosed bays where the local sea is wind-driven rather than swell-driven, wave direction tracks wind direction and everything reads as onshore. That is still better than the alternative, which scored a glassy offshore dawn and a blown-out onshore afternoon identically.

When either bearing is missing the function returns `'unknown'` and applies no directional adjustment at all. Guessing wrong about onshore and offshore is worse than admitting you don't know.

## Alternatives considered

*Keep the weighted sum and lower the wind weight.* This reduces the double-count without eliminating it, and it cannot fix the real limitation: there is no weight at which a term goes positive. Offshore wind genuinely improves conditions, and a weighted sum of quality scores has no way to say so.

*Drop wind entirely and lean on chop.* Throws away direction, gusts, and drift hazard, which are precisely the three things wind uniquely knows.

*Model the shoreline properly* from coastline geometry. This is the correct answer and it is disproportionate. It needs a coastline dataset and a nearest-segment-normal computation, for a signal the wave-direction heuristic already approximates well enough.

## Consequences

Component weights now live inside `seaStateScore` and cover only swell against chop. They sum to 1 and they mean what they say.

`windAdjustment` returns roughly −25 to +8 points and can be unit-tested on its own.

The band tables became piecewise-linear ramps. The originals were step functions, so 0.249 m scored 100 while 0.251 m scored 85, and the hourly strip visibly flickered between verdicts on water that was physically identical.

`factors.windRelation` is now exposed to the UI. That is what lets the conditions bar label the wind "offshore" and rotate the arrow to match.

Safety hazards became caps rather than penalties. See `applyOffshoreDriftCap` and the cold-shock rule. No additive penalty could pull a flat, glassy, 38 km/h offshore day below Go, because the sea state genuinely was excellent. Comfort accumulates. Hazards impose a ceiling.
