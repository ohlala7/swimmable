import { describe, it, expect } from 'vitest';
import {
  scoreSwimming,
  scoreFreediving,
  findBestWindow,
  windRelativeToShore,
  waterTempAdvisory,
  wavelength,
} from './score.js';

/**
 * Base "perfect" hour — flat, calm, warm, offshore-neutral.
 * Wave direction 270 (from the west, i.e. from the sea for a west-facing coast).
 */
const flat = {
  wave_height: 0.12,
  wave_direction: 270,
  swell_wave_height: 0.1,
  swell_wave_period: 10,
  wind_wave_height: 0.04,
  wind_wave_period: 6,
  windspeed_10m: 5,
  windgusts_10m: 7,
  winddirection_10m: 90,   // from the land → offshore
  weathercode: 0,
  sea_surface_temperature: 25,
};

const hour = over => ({ ...flat, ...over });

// ── Wind direction geometry ──────────────────────────────────────────────────

describe('windRelativeToShore', () => {
  it('calls wind onshore when it comes from the same bearing as the waves', () => {
    expect(windRelativeToShore(270, 270)).toBe('onshore');
    expect(windRelativeToShore(300, 270)).toBe('onshore'); // 30° apart
  });

  it('calls wind offshore when it comes from the opposite bearing', () => {
    expect(windRelativeToShore(90, 270)).toBe('offshore');
    expect(windRelativeToShore(120, 270)).toBe('offshore'); // 150° apart
  });

  it('calls wind cross-shore in between', () => {
    expect(windRelativeToShore(0, 270)).toBe('cross-shore'); // 90° apart
  });

  it('wraps correctly across 0/360', () => {
    expect(windRelativeToShore(350, 10)).toBe('onshore');  // 20° apart, not 340
    expect(windRelativeToShore(170, 350)).toBe('offshore'); // 180° apart
  });

  it('returns unknown rather than guessing when a bearing is missing', () => {
    expect(windRelativeToShore(null, 270)).toBe('unknown');
    expect(windRelativeToShore(90, null)).toBe('unknown');
  });
});

// ── Regression: wind was double-counted ──────────────────────────────────────

describe('wind is not double-counted (regression)', () => {
  /**
   * Open-Meteo derives wind_wave_height from the wind field, so chop already
   * encodes wind speed. The old model scored wind again at 30%, which made a
   * breezy-but-swimmable day read "No". A 20 km/h cross-shore breeze over a
   * small sea must stay swimmable.
   */
  it('keeps a moderate breeze over a small sea swimmable', () => {
    const breezy = hour({ windspeed_10m: 20, windgusts_10m: 25, wind_wave_height: 0.14, wave_height: 0.3, winddirection_10m: 0 });
    const result = scoreSwimming(breezy);
    expect(result.verdict).not.toBe('No');
  });

  it('still rejects genuinely blown-out conditions', () => {
    const blownOut = hour({ windspeed_10m: 45, windgusts_10m: 60, wind_wave_height: 0.8, wave_height: 1.4, winddirection_10m: 270 });
    expect(scoreSwimming(blownOut).verdict).toBe('No');
  });
});

// ── Onshore vs offshore ──────────────────────────────────────────────────────

describe('wind direction changes the verdict', () => {
  it('scores offshore wind better than onshore wind at identical speed', () => {
    const base = { windspeed_10m: 14, windgusts_10m: 18, wave_height: 0.35, wind_wave_height: 0.15 };
    const offshore = scoreSwimming(hour({ ...base, winddirection_10m: 90 }));
    const onshore  = scoreSwimming(hour({ ...base, winddirection_10m: 270 }));
    expect(offshore.score).toBeGreaterThan(onshore.score);
  });

  it('penalises strong offshore wind as a drift hazard, not a comfort bonus', () => {
    const breeze = scoreSwimming(hour({ windspeed_10m: 12, winddirection_10m: 90 }));
    const gale   = scoreSwimming(hour({ windspeed_10m: 40, windgusts_10m: 48, winddirection_10m: 90 }));
    expect(gale.score).toBeLessThan(breeze.score);
    expect(gale.factors.offshoreDrift).toBe(true);
    expect(gale.summary).toMatch(/offshore/i);
  });

  /**
   * Safety is a cap, not a penalty. A khamsin blowing 38 km/h straight off the
   * land flattens the sea, so the sea-state score is high and an additive wind
   * penalty could not pull it below Go. A stationary freediver gets blown out
   * to sea on exactly that day.
   */
  it('caps a strong offshore wind to No even over a flat sea', () => {
    const khamsin = hour({
      wave_height: 0.3, wind_wave_height: 0.08,
      windspeed_10m: 38, windgusts_10m: 50, winddirection_10m: 90,
    });
    expect(scoreFreediving(khamsin).verdict).toBe('No');
    expect(scoreSwimming(khamsin).verdict).not.toBe('Go');
  });

  it('flags offshore drift for freedivers at a lower threshold than swimmers', () => {
    const h = hour({ windspeed_10m: 20, winddirection_10m: 90 });
    expect(scoreFreediving(h).factors.offshoreDrift).toBe(true);
    expect(scoreSwimming(h).factors.offshoreDrift).toBe(false);
  });
});

// ── Regression: surge depth was a dead branch ────────────────────────────────

describe('surge depth (regression)', () => {
  /**
   * The old code guarded on period > 12 and then branched on period <= 8 and
   * <= 12, so both were unreachable and it always printed "below 56m".
   */
  it('reports a surge depth that varies with swell period', () => {
    const p13 = scoreFreediving(hour({ swell_wave_period: 13, wave_height: 0.45, wind_wave_height: 0.04 }));
    const p18 = scoreFreediving(hour({ swell_wave_period: 18, wave_height: 0.45, wind_wave_height: 0.04 }));

    const depth = s => Number(s.summary.match(/around (\d+)m/)?.[1]);
    expect(depth(p13)).toBeGreaterThan(0);
    expect(depth(p18)).toBeGreaterThan(depth(p13));
  });

  it('computes deep-water wavelength from period', () => {
    expect(wavelength(10)).toBe(156);
    expect(wavelength(5)).toBe(39);
  });
});

// ── Long-period swell splits the two activities ──────────────────────────────

describe('long-period swell affects the activities in opposite directions', () => {
  it('helps swimming and hurts freediving', () => {
    const short = hour({ swell_wave_period: 8,  wave_height: 0.4 });
    const long  = hour({ swell_wave_period: 15, wave_height: 0.4 });

    expect(scoreSwimming(long).score).toBeGreaterThan(scoreSwimming(short).score);
    expect(scoreFreediving(long).score).toBeLessThan(scoreFreediving(short).score);
  });
});

// ── Continuity: no cliff-edge verdicts ───────────────────────────────────────

describe('scores are continuous (regression)', () => {
  /**
   * The old band table was a step function, so 0.249m scored 100 and 0.251m
   * scored 85 — the hourly strip flickered between verdicts on physically
   * identical water. Interpolation should keep neighbouring inputs close.
   */
  it('does not jump sharply for a tiny change in wave height', () => {
    for (let h = 0.05; h < 1.5; h += 0.01) {
      const a = scoreSwimming(hour({ wave_height: h })).score;
      const b = scoreSwimming(hour({ wave_height: h + 0.01 })).score;
      expect(Math.abs(a - b)).toBeLessThanOrEqual(3);
    }
  });
});

// ── Hard overrides ───────────────────────────────────────────────────────────

describe('hard safety overrides', () => {
  it('zeroes the score for a thunderstorm', () => {
    for (const code of [95, 96, 99]) {
      expect(scoreSwimming(hour({ weathercode: code })).score).toBe(0);
      expect(scoreFreediving(hour({ weathercode: code })).verdict).toBe('No');
    }
  });

  it('caps the score in heavy rain', () => {
    expect(scoreSwimming(hour({ weathercode: 63 })).score).toBeLessThanOrEqual(25);
  });

  it('caps the score in cold-shock water regardless of how clean the sea is', () => {
    const icy = scoreSwimming(hour({ sea_surface_temperature: 9 }));
    expect(icy.score).toBeLessThanOrEqual(40);
    expect(icy.factors.coldCapped).toBe(true);
    expect(icy.summary).toMatch(/cold/i);
  });

  it('does not penalise merely cool water — that is a wetsuit decision', () => {
    const cool = scoreSwimming(hour({ sea_surface_temperature: 18 }));
    expect(cool.verdict).toBe('Go');
    expect(cool.factors.coldCapped).toBe(false);
  });
});

// ── Water temperature advisory ───────────────────────────────────────────────

describe('waterTempAdvisory', () => {
  it('escalates as the water gets colder', () => {
    expect(waterTempAdvisory(27).level).toBe('warm');
    expect(waterTempAdvisory(23).level).toBe('mild');
    expect(waterTempAdvisory(20).level).toBe('cool');
    expect(waterTempAdvisory(17).level).toBe('cold');
    expect(waterTempAdvisory(8).level).toBe('extreme');
  });

  it('returns null when the API gave us no temperature', () => {
    expect(waterTempAdvisory(null)).toBeNull();
  });
});

// ── Summary/verdict consistency ──────────────────────────────────────────────

describe('summary agrees with the verdict (regression)', () => {
  /**
   * The old summaries ran their own independent if-chain, so a card could read
   * "Go" above the words "too big for a quality training swim". Both now derive
   * from the same computed factors.
   */
  it('never describes conditions as too big while returning Go', () => {
    for (let h = 0.05; h < 2; h += 0.05) {
      for (const wind of [4, 15, 28]) {
        const r = scoreSwimming(hour({ wave_height: h, windspeed_10m: wind }));
        if (r.verdict === 'Go') {
          expect(r.summary).not.toMatch(/too big|not suitable|unsafe/i);
        }
      }
    }
  });

  it('never leaks raw API variable names to the user', () => {
    const r = scoreFreediving(hour({ wind_wave_height: 0.3 }));
    expect(r.summary).not.toMatch(/wind_wave_height|swell_wave_period|windspeed_10m/);
  });
});

// ── Missing data ─────────────────────────────────────────────────────────────

describe('degrades gracefully on partial API data', () => {
  /**
   * Regression, found against the live API: Open-Meteo's wave model does not
   * resolve the Gulf of Aqaba, so every marine field for Eilat comes back null.
   * Coercing those to 0 scored "no data" as a flat calm sea and returned
   * "Go (89)" — maximum confidence about a spot the app knows nothing about,
   * at Israel's busiest freediving destination.
   */
  it('refuses to score a spot the marine model does not cover', () => {
    const eilat = {
      time: '2026-08-26T15:00',
      wave_height: null, wave_direction: null, swell_wave_period: null,
      wind_wave_height: null, wind_wave_period: null, sea_surface_temperature: 29.1,
      windspeed_10m: 21, windgusts_10m: 28, winddirection_10m: 13,
      weathercode: 0,
    };

    for (const scorer of [scoreSwimming, scoreFreediving]) {
      const r = scorer(eilat);
      expect(r.verdict).toBe('Unknown');
      expect(r.score).toBeNull();
      expect(r.factors.hasMarineData).toBe(false);
      expect(r.summary).toMatch(/no marine forecast/i);
    }
  });

  it('never reports an unknown spot as a Go window', () => {
    const noData = { time: '2026-08-26T10:00', wave_height: null, windspeed_10m: 5 };
    expect(findBestWindow([noData, noData, noData], 'swimming')).toBeNull();
  });

  it('still scores an hour that has waves but is missing secondary fields', () => {
    const partial = {
      time: '2026-08-26T10:00',
      wave_height: 0.3, wave_direction: null, swell_wave_period: null,
      wind_wave_height: null, wind_wave_period: null,
      windspeed_10m: null, windgusts_10m: null, winddirection_10m: null,
    };
    const r = scoreSwimming(partial);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(['Go', 'Sketchy', 'No']).toContain(r.verdict);
  });

  it('reports unknown wind relation rather than guessing a direction', () => {
    const r = scoreSwimming(hour({ winddirection_10m: null }));
    expect(r.factors.windRelation).toBe('unknown');
  });
});

// ── Bounds ───────────────────────────────────────────────────────────────────

describe('score stays within 0–100', () => {
  it('never goes below 0', () => {
    const worst = hour({ wave_height: 4, wind_wave_height: 2, windspeed_10m: 80, windgusts_10m: 110, winddirection_10m: 90 });
    expect(scoreSwimming(worst).score).toBeGreaterThanOrEqual(0);
    expect(scoreFreediving(worst).score).toBeGreaterThanOrEqual(0);
  });

  it('never exceeds 100', () => {
    const best = hour({ wave_height: 0.02, wind_wave_height: 0, swell_wave_period: 16, windspeed_10m: 8, winddirection_10m: 90 });
    expect(scoreSwimming(best).score).toBeLessThanOrEqual(100);
    expect(scoreFreediving(best).score).toBeLessThanOrEqual(100);
  });
});

// ── Go windows ───────────────────────────────────────────────────────────────

describe('findBestWindow', () => {
  const go  = hour({});
  const no  = hour({ wave_height: 2.5, wind_wave_height: 1.2, windspeed_10m: 50 });

  it('finds the longest run of Go hours', () => {
    const day = [go, go, no, go, go, go, no];
    const win = findBestWindow(day, 'swimming');
    expect(win).toEqual({ startHour: 3, endHour: 5, durationH: 3 });
  });

  it('ignores runs shorter than two hours', () => {
    expect(findBestWindow([go, no, go, no], 'swimming')).toBeNull();
  });

  it('closes a run that reaches the end of the day', () => {
    const win = findBestWindow([no, go, go, go], 'swimming');
    expect(win).toEqual({ startHour: 1, endHour: 3, durationH: 3 });
  });

  it('returns null when nothing is good', () => {
    expect(findBestWindow([no, no, no], 'swimming')).toBeNull();
  });

  /**
   * Regression: the old implementation required BOTH activities to be Go, so a
   * flawless swimming day with marginal freediving reported no window at all.
   */
  it('answers per activity rather than requiring both to agree', () => {
    // Substantial long-period swell: a rolling, swimmable sea, but surge at depth.
    // (0.5m at 16s is NOT enough — surge depth is T²/4 = 64m, far below any
    // recreational dive. Surge only bites once there is real water moving.)
    const swimOnly = hour({ swell_wave_period: 16, wave_height: 0.85, wind_wave_height: 0.08 });
    const day = [swimOnly, swimOnly, swimOnly];

    expect(scoreSwimming(swimOnly).verdict).toBe('Go');
    expect(scoreFreediving(swimOnly).verdict).not.toBe('Go');

    expect(findBestWindow(day, 'swimming')).not.toBeNull();
    expect(findBestWindow(day, 'freediving')).toBeNull();
  });
});
