/**
 * @vitest-environment jsdom
 *
 * Integration tests for the render layer.
 *
 * The unit tests cover the scoring maths, but every bug that actually reached a
 * user in this app was a wiring bug: an element id renamed in one place and not
 * another, a CSS custom property deleted while something still referenced it, a
 * function whose signature changed under its caller. Those are invisible to
 * pure-function tests and to the type system (there isn't one), so they get
 * caught here by rendering into a real DOM built from the shipped index.html.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { renderVerdicts, showSkeletons, getSwimResult, getDiveResult } from './verdict.js';
import { renderHourlyStrip } from './hourly.js';
import { renderDaySelector } from './daySelector.js';
import { openDetailSheet, closeDetailSheet, initDetailSheet } from './sheet.js';
import { scoreSwimming } from '../forecast/score.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../index.html'), 'utf8');

/** Load the real shipped markup, so a renamed id fails the test. */
function mountApp() {
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  document.body.innerHTML = body;
}

const baseHour = (over = {}) => ({
  time: '2026-08-26T09:00',
  wave_height: 0.3,
  wave_direction: 270,
  swell_wave_height: 0.25,
  swell_wave_period: 9,
  wind_wave_height: 0.08,
  wind_wave_period: 5,
  windspeed_10m: 12,
  windgusts_10m: 16,
  winddirection_10m: 90,
  weathercode: 0,
  sea_surface_temperature: 25,
  ...over,
});

const day = (n = 12, over = {}) =>
  Array.from({ length: n }, (_, i) =>
    baseHour({ time: `2026-08-26T${String(i + 6).padStart(2, '0')}:00`, ...over }));

beforeEach(() => {
  mountApp();
  // jsdom implements no layout, so it has no scrollIntoView. Stub it rather than
  // guarding in the source — every real browser has it, and production code
  // should not carry branches that exist only for the test environment.
  Element.prototype.scrollIntoView = () => {};
});

describe('renderVerdicts', () => {
  it('fills both cards and the conditions bar from one hour of data', () => {
    renderVerdicts(baseHour(), day(), false);

    expect(document.getElementById('swim-verdict').textContent).toMatch(/Go|Sketchy|No/);
    expect(document.getElementById('dive-verdict').textContent).toMatch(/Go|Sketchy|No/);
    expect(document.getElementById('swim-summary').textContent.length).toBeGreaterThan(5);

    expect(document.getElementById('cond-wave').textContent).toBe('0.3m');
    expect(document.getElementById('cond-temp').textContent).toBe('25°');
    expect(document.getElementById('cond-wind').textContent).toBe('12');
  });

  it('labels the wind with its relation to shore', () => {
    renderVerdicts(baseHour({ winddirection_10m: 90, wave_direction: 270 }), [], false);
    expect(document.getElementById('cond-wind-label').textContent).toContain('offshore');

    renderVerdicts(baseHour({ winddirection_10m: 270, wave_direction: 270 }), [], false);
    expect(document.getElementById('cond-wind-label').textContent).toContain('onshore');
  });

  it('points the wind arrow the way the wind blows, not where it comes from', () => {
    renderVerdicts(baseHour({ winddirection_10m: 90 }), [], false);
    expect(document.getElementById('wind-arrow').style.transform).toBe('rotate(270deg)');
  });

  it('shows an em dash rather than a fabricated zero when data is missing', () => {
    renderVerdicts(baseHour({ sea_surface_temperature: null, wave_height: null }), [], false);
    expect(document.getElementById('cond-temp').textContent).toBe('—');
    expect(document.getElementById('cond-wave').textContent).toBe('—');
  });

  it('drives the ambient tint from the better of the two verdicts', () => {
    renderVerdicts(baseHour(), [], false);
    expect(document.getElementById('tab-conditions').dataset.ambient).toMatch(/Go|Sketchy|No/);
  });

  it('hides Go windows for today and shows them for future days', () => {
    renderVerdicts(baseHour(), day(), false);
    expect(document.getElementById('swim-window').hidden).toBe(true);

    renderVerdicts(baseHour(), day(), true);
    const chip = document.getElementById('swim-window');
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toMatch(/^Best \d/);
  });

  it('renders an uncovered spot as Unknown with no ambient colour or window', () => {
    const uncovered = baseHour({
      wave_height: null, wind_wave_height: null, swell_wave_period: null, wave_direction: null,
    });
    renderVerdicts(uncovered, [uncovered, uncovered, uncovered], true);

    expect(document.getElementById('swim-verdict').textContent).toBe('Unknown');
    expect(document.getElementById('card-swimming').dataset.verdict).toBe('Unknown');
    expect(document.getElementById('swim-window').hidden).toBe(true);
    expect(document.getElementById('tab-conditions').dataset.ambient).toBeUndefined();
    expect(document.getElementById('cond-wave').textContent).toBe('—');
  });

  it('exposes the rendered results to the detail sheet', () => {
    renderVerdicts(baseHour(), [], false);
    expect(getSwimResult().verdict).toBe(scoreSwimming(baseHour()).verdict);
    expect(getDiveResult()).not.toBeNull();
  });
});

describe('showSkeletons', () => {
  it('clears every field it is responsible for', () => {
    renderVerdicts(baseHour(), day(), true);
    showSkeletons();

    expect(document.getElementById('cond-wave').textContent).toBe('—');
    expect(document.getElementById('swim-verdict').textContent).toBe('—');
    expect(document.getElementById('swim-window').hidden).toBe(true);
    expect(document.getElementById('card-swimming').dataset.verdict).toBeUndefined();
    expect(document.getElementById('tab-conditions').dataset.ambient).toBeUndefined();
  });
});

describe('renderHourlyStrip', () => {
  it('draws one bar per hour with a height and a verdict', () => {
    const hours = day(10);
    renderHourlyStrip(hours, hours[3].time);

    const bars = document.querySelectorAll('.hourly-bar');
    expect(bars).toHaveLength(10);
    for (const bar of bars) {
      expect(bar.dataset.verdict).toMatch(/Go|Sketchy|No/);
      expect(parseFloat(bar.style.height)).toBeGreaterThanOrEqual(6);
    }
  });

  it('marks the current hour exactly once', () => {
    const hours = day(10);
    renderHourlyStrip(hours, hours[3].time);
    expect(document.querySelectorAll('.hourly-item.current-hour')).toHaveLength(1);
  });

  it('labels every third hour to keep the axis readable on a narrow screen', () => {
    const hours = day(9);
    renderHourlyStrip(hours, 'no-match');
    const labelled = [...document.querySelectorAll('.hourly-time')].filter(el => el.textContent);
    expect(labelled).toHaveLength(3);
  });

  it('replaces the previous day rather than appending to it', () => {
    renderHourlyStrip(day(10), '');
    renderHourlyStrip(day(6), '');
    expect(document.querySelectorAll('.hourly-item')).toHaveLength(6);
  });
});

describe('renderDaySelector', () => {
  it('renders one pill per day and marks the selected one', () => {
    renderDaySelector([day(), day(), day()], 1, () => {});
    const pills = document.querySelectorAll('.day-pill');
    expect(pills).toHaveLength(3);
    expect(pills[1].classList.contains('active')).toBe(true);
    expect(pills[0].textContent).toContain('Today');
  });

  /**
   * Regression: the day dot re-derived its verdict from raw scores using its own
   * copy of the 72/42 thresholds. When the profiles were retuned the copy went
   * stale, so a dot could contradict the card directly beneath it.
   */
  it('agrees with the verdict cards', () => {
    const hours = day();
    renderDaySelector([hours], 0, () => {});
    renderVerdicts(hours[0], hours, false);

    const dot = document.querySelector('.day-pill-dot').dataset.verdict;
    const card = document.getElementById('swim-verdict').textContent;
    const rank = { No: 0, Sketchy: 1, Go: 2 };
    expect(rank[dot]).toBeGreaterThanOrEqual(rank[card]); // dot shows the day's best
  });
});

describe('detail sheet', () => {
  it('opens with the summary, factor breakdown and supporting facts', () => {
    initDetailSheet();
    const h = baseHour();
    openDetailSheet('Swimming', h, scoreSwimming(h), null);

    expect(document.getElementById('detail-sheet').hidden).toBe(false);
    expect(document.getElementById('detail-activity').textContent).toBe('Swimming');
    expect(document.getElementById('detail-wave-num').textContent).toBe('0.3');

    expect(document.querySelectorAll('.factor-row')).toHaveLength(3);
    expect(document.querySelectorAll('.meta-chip').length).toBeGreaterThan(0);
  });

  it('marks exactly the limiting factor, matching what the summary talks about', () => {
    initDetailSheet();
    const rough = baseHour({ wind_wave_height: 0.55, windspeed_10m: 30, winddirection_10m: 270 });
    const result = scoreSwimming(rough);
    openDetailSheet('Swimming', rough, result, null);

    const marked = [...document.querySelectorAll('.factor-row')]
      .filter(r => r.dataset.limiting === 'true');
    expect(marked.length).toBeLessThanOrEqual(1);
    if (result.factors.limiting !== 'none') {
      expect(marked).toHaveLength(1);
      expect(marked[0].textContent.toLowerCase()).toContain(result.factors.limiting);
    }
  });

  it('draws no factor bars for an uncovered spot rather than three full ones', () => {
    initDetailSheet();
    const uncovered = baseHour({ wave_height: null, wind_wave_height: null });
    openDetailSheet('Swimming', uncovered, scoreSwimming(uncovered), null);
    expect(document.querySelectorAll('.factor-row')).toHaveLength(0);
  });

  it('hides the live-cam button when there is no cam', () => {
    initDetailSheet();
    const h = baseHour();
    openDetailSheet('Swimming', h, scoreSwimming(h), null);
    expect(document.getElementById('btn-cam').hidden).toBe(true);
  });

  it('closes cleanly and restores page scrolling', () => {
    initDetailSheet();
    const h = baseHour();
    openDetailSheet('Swimming', h, scoreSwimming(h), null);
    closeDetailSheet();
    expect(document.getElementById('detail-sheet').hidden).toBe(true);
    expect(document.body.style.overflow).toBe('');
  });
});
