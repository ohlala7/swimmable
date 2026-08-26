# ADR 0001 · Two Scoring Algorithms, One for Each Activity

**Status:** Accepted, amended by [ADR 0002](0002-additive-scoring-model.md) and [ADR 0003](0003-unknown-verdict.md)

## Decision

Produce an independent Score and Verdict for Swimming and for Freediving, rather than one answer with an activity caveat attached.

## Context

The app's author is both an Ironman triathlete and a freediver, and those two activities respond differently to identical water.

Chop matters to both, but not for the same reason. For Swimming it disrupts long-distance stroke and navigation. For Freediving it is the primary *safety* signal, because it breaks up breath recovery between dives and makes entry and exit dangerous.

Swell period is the case that forced the decision. A period above 12s is a mild positive for Swimming, since the waves roll through more smoothly, and the same long period is a negative for Freediving because it drives Surge down to roughly T²/4 metres. One signal, two opposite signs, which no shared weight can express.

Wave-height thresholds differ too. A freediver cares more about surface state than total sea state. A swimmer three kilometres into a training session on tired arms cares about the opposite.

## Alternatives considered

*One algorithm with activity multipliers,* meaning a shared base score with per-activity weight overrides. Rejected because a weight cannot flip a sign. Expressing the swell-period inversion would need branching, and that branching is two functions wearing a disguise.

*One worst-case verdict,* showing whichever of the two is more conservative. Rejected because it throws away the answer the user came for. Plenty of days are good for one activity and poor for the other, and collapsing them hides exactly the information that makes the app worth opening.

## Consequences

`score.js` exports `scoreSwimming(hour)` and `scoreFreediving(hour)`. Both take the same hourly shape from Open-Meteo and both return `{ score, verdict, summary, factors }`.

The UI always renders two Verdict Cards. There is no single-verdict mode.

Tests have to cover both functions independently, and several assert that the two *disagree* under conditions where they should, since a bug that quietly collapsed them into one answer would otherwise pass everything.

## Amendment, after ADR 0002

The two functions now share one pipeline, `scoreActivity(hour, profile, activity)`, and differ only by a tuning profile. That reads like the "activity multipliers" option rejected above, so it is worth saying why it isn't.

The rejected design was a single set of weights nudged per activity. What exists now is a shared *structure* with per-activity constants, including `longPeriodBonus` and `surgePenalty` as separate knobs precisely so the period signal can point one way for swimming and the other for freediving. The sign inversion is expressed directly instead of being smuggled through a weight.

Sharing the pipeline also keeps the two honestly comparable. When they drifted apart as independent copies, they picked up separate bugs: the freediving summary carried a dead ternary branch that always reported surge at 56 m, and nothing in the swimming path could have caught it.
