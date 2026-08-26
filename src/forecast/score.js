/**
 * Scoring algorithms for Swimming and Freediving.
 * See docs/adr/0001-two-activity-scoring.md for why these are separate.
 * See docs/adr/0002-additive-scoring-model.md for why this is additive, not weighted.
 *
 * Scores (0–100) are internal only — never shown to the user. The user sees a Verdict.
 */

// ── Physical constants ───────────────────────────────────────────────────────

/**
 * Deep-water wavelength: L = (g / 2π) · T²  ≈  1.56 · T²  metres.
 * Used to reason about how deep wave motion reaches.
 */
const WAVELENGTH_COEF = 1.56;

/**
 * Practical surge-depth rule used by divers: noticeable water movement persists
 * to roughly T²/4 metres. This is shallower than the theoretical wave base (L/2)
 * because "negligible motion" and "no longer annoying" are different thresholds.
 */
function surgeDepth(periodSeconds) {
  return Math.round((periodSeconds * periodSeconds) / 4);
}

/** Deep-water wavelength in metres, for display/explanation. */
export function wavelength(periodSeconds) {
  return Math.round(WAVELENGTH_COEF * periodSeconds * periodSeconds);
}

// ── Small helpers ────────────────────────────────────────────────────────────

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Piecewise-linear interpolation over [value, score] control points.
 *
 * Replaces the old bandScore(), which was a step function: 0.249m scored 100 and
 * 0.251m scored 85. That cliff made the hourly strip flicker between verdicts on
 * physically identical conditions. Interpolating removes the discontinuity.
 */
function ramp(value, points) {
  if (value <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (value <= x1) {
      const t = (value - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

/** Smallest absolute angle between two compass bearings, in degrees (0–180). */
function angleBetween(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

// ── Wind direction relative to shore ─────────────────────────────────────────

/**
 * Classify wind as onshore / offshore / cross-shore.
 *
 * We never know the shoreline's true orientation for an arbitrary dropped pin,
 * so we infer it: swell is generated far out at sea and travels shoreward, so
 * the bearing the waves arrive FROM is approximately the seaward direction.
 *
 * Both wave_direction and winddirection_10m are meteorological convention —
 * the direction the thing comes FROM.
 *
 *   wind from ≈ same bearing as waves  → blowing shoreward   → ONSHORE
 *   wind from ≈ opposite bearing       → blowing seaward     → OFFSHORE
 *   otherwise                          → CROSS-SHORE
 *
 * This is a heuristic and it fails in enclosed bays where local swell is
 * wind-driven. It is still far better than ignoring direction entirely, which
 * treats a glassy offshore morning and a blown-out onshore afternoon as equal.
 */
export function windRelativeToShore(windDirection, waveDirection) {
  if (windDirection == null || waveDirection == null) return 'unknown';
  const delta = angleBetween(windDirection, waveDirection);
  if (delta <= 60) return 'onshore';
  if (delta >= 120) return 'offshore';
  return 'cross-shore';
}

/**
 * Does the marine model actually cover this spot?
 *
 * Wave height is the load-bearing input: without it there is no sea state, and
 * everything downstream is guesswork. Wind alone is not enough to judge water.
 */
export function hasMarineData(hour) {
  return hour?.wave_height != null;
}

/**
 * Fill absent readings with neutral values so a partial API response degrades
 * gracefully instead of throwing. Directions stay null — an unknown bearing must
 * not be guessed, because a wrong onshore/offshore call is worse than none.
 *
 * This runs only once hasMarineData() has confirmed the spot is covered, so it
 * fills genuine gaps in a real forecast, never a wholly absent one.
 */
function normalizeHour(h) {
  return {
    ...h,
    wave_height:             h.wave_height             ?? 0,
    wind_wave_height:        h.wind_wave_height        ?? 0,
    wind_wave_period:        h.wind_wave_period        ?? 6,
    swell_wave_period:       h.swell_wave_period       ?? 8,
    windspeed_10m:           h.windspeed_10m           ?? 0,
    windgusts_10m:           h.windgusts_10m           ?? h.windspeed_10m ?? 0,
    weathercode:             h.weathercode             ?? 0,
    sea_surface_temperature: h.sea_surface_temperature ?? null,
    winddirection_10m:       h.winddirection_10m       ?? null,
    wave_direction:          h.wave_direction          ?? null,
  };
}

/** Gust factor: how much gustier than the mean wind. ~1.0 = steady, >1.5 = squally. */
function gustFactor(windspeed, gusts) {
  if (!windspeed || windspeed < 3) return 1;
  return (gusts ?? windspeed) / windspeed;
}

// ── Component scores ─────────────────────────────────────────────────────────

/**
 * Sea state: how big and how disorganised the water is.
 *
 * Swell (long, organised) and chop (short, wind-driven) are scored separately
 * because they feel completely different in the water at the same height.
 * Chop is weighted heavier for both activities — a choppy 0.4m sea is harder
 * work than a swelly 0.4m sea.
 */
function seaStateScore(waveHeight, chopHeight, swellWeight, chopWeight) {
  const swellS = ramp(waveHeight, [
    [0.10, 100], [0.30, 92], [0.50, 75], [0.80, 48], [1.20, 20], [2.00, 0],
  ]);
  const chopS = ramp(chopHeight, [
    [0.05, 100], [0.15, 88], [0.30, 65], [0.50, 35], [0.80, 10], [1.20, 0],
  ]);
  const total = swellWeight + chopWeight;
  return (swellS * swellWeight + chopS * chopWeight) / total;
}

/**
 * Wind adjustment — a MODIFIER, not an independent weighted term.
 *
 * This is the main correction to the previous model. Open-Meteo derives
 * wind_wave_height from the wind field, so chop already encodes wind speed.
 * Scoring wind again at 30% double-counted a single physical cause and made
 * the app pessimistic on every breezy day.
 *
 * What wind tells us that chop does NOT:
 *   · direction  — offshore flattens the surface, onshore stacks it up
 *   · gustiness  — squally wind is unpleasant in ways mean wind doesn't capture
 *   · offshore drift — a safety hazard specific to swimming/diving from shore
 *
 * @returns {number} adjustment in score points, roughly -25 … +8
 */
function windAdjustment(hour, { offshoreDriftThreshold }) {
  const { windspeed_10m = 0, windgusts_10m, winddirection_10m, wave_direction } = hour;

  let adj = 0;

  // Residual raw-strength penalty, deliberately small — chop carries most of it.
  adj -= ramp(windspeed_10m, [[0, 0], [15, 0], [25, 4], [35, 10], [50, 18]]);

  const relation = windRelativeToShore(winddirection_10m, wave_direction);

  if (relation === 'offshore') {
    // Offshore grooms the surface — genuinely nicer water, up to a point.
    adj += ramp(windspeed_10m, [[0, 0], [8, 4], [18, 6], [25, 2], [35, 0]]);

    // ...but past a threshold it pushes swimmers and divers away from shore.
    // Safety beats comfort: this penalty is intentionally larger than the bonus.
    if (windspeed_10m >= offshoreDriftThreshold) {
      adj -= ramp(windspeed_10m, [
        [offshoreDriftThreshold, 0],
        [offshoreDriftThreshold + 15, 18],
        [offshoreDriftThreshold + 30, 30],
      ]);
    }
  } else if (relation === 'onshore') {
    // Onshore piles water against the shore: messier shorebreak, poorer visibility.
    adj -= ramp(windspeed_10m, [[0, 0], [12, 2], [22, 8], [35, 14]]);
  }

  // Squalls: gusts well above the mean mean unpredictable surface.
  const gf = gustFactor(windspeed_10m, windgusts_10m);
  if (gf > 1.5 && windspeed_10m > 12) adj -= ramp(gf, [[1.5, 0], [2.0, 5], [2.6, 10]]);

  return adj;
}

/** WMO weathercode hard limits. Lightning is absolute; heavy rain is a hard cap. */
function applyWeatherOverride(score, weathercode) {
  if (weathercode >= 95) return 0;                                        // Thunderstorm
  if (weathercode >= 61 && weathercode <= 67) return Math.min(score, 25); // Heavy rain
  return score;
}

/**
 * Water temperature.
 *
 * Deliberately NOT part of the score. Most users own a wetsuit, so 17°C is a
 * "bring the 3mm" fact, not a "don't go" verdict — folding it into the score
 * would tell a wetsuited freediver No on a flat, clean day. We surface it as a
 * fact and an advisory instead.
 *
 * The one exception is genuine cold-shock territory (<13°C), which is a hazard
 * regardless of intent, so it caps the score.
 */
/**
 * Strong offshore wind is a hard cap, not an additive penalty.
 *
 * Additive penalties are the wrong tool for hazards. A 38 km/h offshore wind
 * over a beautifully flat sea produced a high sea-state score that the wind
 * penalty could only partly claw back, so the app said "Sketchy" on a day that
 * blows a stationary freediver out to sea. Comfort is additive; safety is a cap.
 */
function applyOffshoreDriftCap(score, hour, profile) {
  const relation = windRelativeToShore(hour.winddirection_10m, hour.wave_direction);
  if (relation !== 'offshore') return score;

  const over = (hour.windspeed_10m ?? 0) - profile.offshoreDriftThreshold;
  if (over >= 20) return Math.min(score, 35);  // No
  if (over >= 12) return Math.min(score, 55);  // Sketchy at best
  return score;
}

const COLD_SHOCK_C = 13;

function applyColdWaterCap(score, seaTemp) {
  if (seaTemp == null) return score;
  if (seaTemp < COLD_SHOCK_C) return Math.min(score, 40);
  return score;
}

export function waterTempAdvisory(seaTemp) {
  if (seaTemp == null) return null;
  if (seaTemp >= 26) return { level: 'warm',  text: 'Warm. Swimsuit is fine.' };
  if (seaTemp >= 22) return { level: 'mild',  text: 'Comfortable without a wetsuit.' };
  if (seaTemp >= 19) return { level: 'cool',  text: 'Cool. A shorty is nice for long sessions.' };
  if (seaTemp >= 16) return { level: 'cold',  text: 'Cold. Wetsuit recommended.' };
  if (seaTemp >= COLD_SHOCK_C) return { level: 'cold', text: 'Very cold. Wetsuit needed.' };
  return { level: 'extreme', text: 'Cold-shock range. Proper thermal protection and never alone.' };
}

// ── Summaries ────────────────────────────────────────────────────────────────

/**
 * Summaries are derived from the LIMITING FACTOR — the component that cost the
 * most points — rather than from an independent if-chain.
 *
 * The old version evaluated its own thresholds, so the text could contradict the
 * verdict: a card could read "Go" above the words "too big for a quality swim".
 * Deriving both from the same numbers makes that impossible by construction.
 */
function describe(hour, factors, verdict, activity) {
  const { weathercode = 0, swell_wave_period = 8, windspeed_10m = 0 } = hour;

  if (weathercode >= 95) return 'Thunderstorm in the area. Do not enter the water.';
  if (weathercode >= 61 && weathercode <= 67) return 'Heavy rain. Conditions not suitable.';
  if (factors.coldCapped) return 'Water is in cold-shock range. Thermal protection essential.';

  const relation = factors.windRelation;

  // Safety first: offshore drift outranks every comfort observation.
  if (factors.offshoreDrift) {
    return `Strong offshore wind — it will push you away from shore. ${
      activity === 'freediving' ? 'Dive with a boat or a float line, or pick another day.' : 'Not a day for distance swimming.'
    }`;
  }

  // Surge is a freediving-specific advisory and must surface even when nothing
  // is "limiting": a long-period swell can look glassy from the beach and still
  // throw you around at 20m. It is the one hazard the surface does not show.
  if (activity === 'freediving' && swell_wave_period > 12 && (hour.wave_height ?? 0) >= 0.35) {
    return `Long-period swell — expect surge to around ${surgeDepth(swell_wave_period)}m.`;
  }

  const worst = factors.limiting;

  if (worst === 'chop') {
    if (verdict === 'No') {
      return activity === 'freediving'
        ? 'Surface too broken for safe breath-hold recovery between dives.'
        : 'Wind chop will break up your stroke badly.';
    }
    return activity === 'freediving'
      ? 'Wind chop makes surface recovery harder between dives.'
      : 'Chop on the surface. Manageable, but you will feel it.';
  }

  if (worst === 'swell') {
    if (verdict === 'No') return 'Swell is too big for a comfortable session.';
    return 'Moderate swell running. Hard work over a long session.';
  }

  if (worst === 'wind') {
    if (relation === 'onshore') return `Onshore wind at ${Math.round(windspeed_10m)} km/h stacking up the shorebreak.`;
    if (relation === 'cross-shore') return `Cross-shore wind at ${Math.round(windspeed_10m)} km/h roughening the surface.`;
    return `Wind at ${Math.round(windspeed_10m)} km/h. Expect a textured surface.`;
  }

  // Nothing is limiting — say something specific about why it's good.
  if (relation === 'offshore' && windspeed_10m > 6) {
    return activity === 'freediving'
      ? 'Offshore breeze grooming the surface. Glassy, good visibility likely.'
      : 'Offshore breeze holding the surface flat. Excellent swimming.';
  }
  if (swell_wave_period > 12) return 'Clean long-period swell and a settled surface.';
  return activity === 'freediving'
    ? 'Glassy surface. Comfortable breath recovery.'
    : 'Flat and calm. Good session ahead.';
}

// ── Core scoring ─────────────────────────────────────────────────────────────

/**
 * Shared scoring pipeline. Both activities use the same structure and differ
 * only in their tuning profile — that keeps the two algorithms honestly
 * comparable instead of drifting apart as we tune them.
 */
function scoreActivity(rawHour, profile, activity) {
  // No marine model coverage → no verdict. Open-Meteo's wave model does not
  // resolve small enclosed basins (the Gulf of Aqaba, i.e. Eilat, is the case
  // that matters most here), and returns nulls rather than an error.
  //
  // Coercing those nulls to 0 scores a total absence of data as a flat, calm
  // sea and hands a freediver "Go" for a spot the app knows nothing about.
  // Saying "unknown" is the only honest option, and unlike a wrong Go it
  // cannot get anyone hurt.
  if (!hasMarineData(rawHour)) {
    return {
      score: null,
      verdict: 'Unknown',
      summary: 'No marine forecast covers this spot. Check locally before you get in.',
      factors: {
        sea: null, wind: null, period: null,
        windRelation: 'unknown', offshoreDrift: false, coldCapped: false,
        limiting: 'none', swellCost: 0, chopCost: 0, windCost: 0,
        hasMarineData: false,
      },
    };
  }

  // Coalesce with ?? rather than destructuring defaults: mergeHourly emits null
  // for absent readings, and `const { x = 0 } = { x: null }` yields null, not 0.
  const hour = normalizeHour(rawHour);
  const {
    wave_height,
    wind_wave_height,
    wind_wave_period,
    swell_wave_period,
    windspeed_10m,
    weathercode,
    sea_surface_temperature,
  } = hour;

  const sea = seaStateScore(wave_height, wind_wave_height, profile.swellWeight, profile.chopWeight);
  const wind = windAdjustment(hour, profile);

  // Period effects. Long-period swell is smoother on the surface but reaches
  // deeper — a comfort bonus for swimmers, a surge problem for freedivers.
  //
  // The two are modelled separately because they scale differently. Surface
  // smoothness is roughly binary: swell either is long-period or it isn't.
  // Surge intensity scales with how much water is moving, so a 0.2m 15s swell
  // is a non-event at depth while a 1.0m 15s swell is not.
  let period = 0;
  if (swell_wave_period > 12) {
    period += profile.longPeriodBonus;
    const surgeIntensity = clamp(wave_height / 0.4, 0.25, 2.5);
    period -= profile.surgePenalty * surgeIntensity;
  }
  if (swell_wave_period < 6) period -= 8;
  if (wind_wave_period < 5 && wind_wave_height > 0.1) period -= profile.shortChopPeriod;

  let score = clamp(sea + wind + period);
  score = applyOffshoreDriftCap(score, hour, profile);

  const beforeCold = score;
  score = applyColdWaterCap(score, sea_surface_temperature);
  const coldCapped = score < beforeCold;

  score = clamp(Math.round(score));
  score = applyWeatherOverride(score, weathercode);

  const verdict = score >= profile.goThreshold ? 'Go'
                : score >= profile.sketchyThreshold ? 'Sketchy'
                : 'No';

  // Which single component cost the most? Used for the summary and the UI breakdown.
  const swellCost = 100 - ramp(wave_height, [[0.10, 100], [0.30, 92], [0.50, 75], [0.80, 48], [1.20, 20], [2.00, 0]]);
  const chopCost  = 100 - ramp(wind_wave_height, [[0.05, 100], [0.15, 88], [0.30, 65], [0.50, 35], [0.80, 10], [1.20, 0]]);
  const windCost  = Math.max(0, -wind);

  const costs = { swell: swellCost * profile.swellWeight, chop: chopCost * profile.chopWeight, wind: windCost };
  const limiting = Object.entries(costs).sort((a, b) => b[1] - a[1])[0];

  const relation = windRelativeToShore(hour.winddirection_10m, hour.wave_direction);

  const factors = {
    sea: Math.round(sea),
    wind: Math.round(wind),
    period: Math.round(period),
    windRelation: relation,
    offshoreDrift: relation === 'offshore' && windspeed_10m >= profile.offshoreDriftThreshold,
    coldCapped,
    limiting: limiting[1] > 8 ? limiting[0] : 'none',
    swellCost: Math.round(swellCost),
    chopCost: Math.round(chopCost),
    windCost: Math.round(windCost),
    hasMarineData: true,
  };

  return {
    score,
    verdict,
    factors,
    summary: describe(hour, factors, verdict, activity),
  };
}

// ── Tuning profiles ──────────────────────────────────────────────────────────

const SWIM_PROFILE = {
  swellWeight: 0.40,
  chopWeight: 0.60,          // chop wrecks stroke efficiency more than swell height does
  longPeriodBonus: 5,        // long, rolling swell is easier to swim through than chop
  surgePenalty: 0,           // swimmers stay at the surface — surge at depth is irrelevant
  shortChopPeriod: 8,
  offshoreDriftThreshold: 22, // km/h — swimmers travel further from shore than divers
  goThreshold: 70,
  sketchyThreshold: 42,
};

const DIVE_PROFILE = {
  swellWeight: 0.35,
  chopWeight: 0.65,          // surface recovery between dives is the binding constraint
  longPeriodBonus: 2,        // a calmer surface still helps recovery between dives
  surgePenalty: 9,           // ...but the same swell drags you around at depth
  shortChopPeriod: 11,
  offshoreDriftThreshold: 18, // divers float stationary on the surface; drift bites sooner
  goThreshold: 73,
  sketchyThreshold: 45,
};

/**
 * Score swimming conditions for a single hour.
 * @param {object} hour - Combined hourly data from Open-Meteo
 * @returns {{ score: number, verdict: 'Go'|'Sketchy'|'No', summary: string, factors: object }}
 */
export function scoreSwimming(hour) {
  return scoreActivity(hour, SWIM_PROFILE, 'swimming');
}

/**
 * Score freediving conditions for a single hour.
 * @param {object} hour - Combined hourly data from Open-Meteo
 * @returns {{ score: number, verdict: 'Go'|'Sketchy'|'No', summary: string, factors: object }}
 */
export function scoreFreediving(hour) {
  return scoreActivity(hour, DIVE_PROFILE, 'freediving');
}

// ── Go windows ───────────────────────────────────────────────────────────────

/**
 * Find the longest run of consecutive Go hours for ONE activity.
 *
 * Previously this required BOTH activities to be Go simultaneously, so a
 * flawless swimming day with marginal freediving reported no window at all.
 * The user has picked an activity; the window should answer for that activity.
 *
 * @param {object[]} hours
 * @param {'swimming'|'freediving'} activity
 * @returns {{ startHour: number, endHour: number, durationH: number } | null}
 */
export function findBestWindow(hours, activity = 'swimming') {
  const scorer = activity === 'freediving' ? scoreFreediving : scoreSwimming;
  const MIN_WINDOW_HOURS = 2;

  let best = null;
  let runStart = null;
  let runLen = 0;

  const commit = () => {
    if (runLen >= MIN_WINDOW_HOURS && (!best || runLen > best.durationH)) {
      best = { startHour: runStart, endHour: runStart + runLen - 1, durationH: runLen };
    }
  };

  for (let i = 0; i < hours.length; i++) {
    if (scorer(hours[i]).verdict === 'Go') {
      if (runStart === null) runStart = i;
      runLen++;
    } else {
      commit();
      runStart = null;
      runLen = 0;
    }
  }
  commit();

  return best;
}
