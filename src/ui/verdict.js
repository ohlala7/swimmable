import { scoreSwimming, scoreFreediving, findBestWindow } from '../forecast/score.js';
import { formatWindow } from '../forecast/openmeteo.js';

let currentSwim = null;
let currentDive = null;
let currentHour = null;

/**
 * Render both verdict cards, the at-a-glance conditions bar, and the ambient
 * tint behind the screen.
 *
 * @param {object} hour        the hour being shown
 * @param {object[]} dayHours  every hour of that day, for the Go-window search
 * @param {boolean} showWindows future days get a "best window" chip; today does not,
 *                              because a window that has already passed is noise
 */
export function renderVerdicts(hour, dayHours = [], showWindows = false) {
  currentSwim = scoreSwimming(hour);
  currentDive = scoreFreediving(hour);
  currentHour = hour;

  setCard('card-swimming',  'swim-verdict', 'swim-summary', 'swim-window', currentSwim, dayHours, showWindows, 'swimming');
  setCard('card-freediving', 'dive-verdict', 'dive-summary', 'dive-window', currentDive, dayHours, showWindows, 'freediving');

  renderConditionsBar(hour, currentSwim);
  setAmbient(currentSwim.verdict, currentDive.verdict);
}

function setCard(cardId, wordId, summaryId, windowId, result, dayHours, showWindows, activity) {
  const card    = document.getElementById(cardId);
  const word    = document.getElementById(wordId);
  const summary = document.getElementById(summaryId);
  const windowEl = document.getElementById(windowId);

  card.dataset.verdict = result.verdict;
  card.classList.remove('skeleton-loading');

  word.textContent = result.verdict;
  word.dataset.verdict = result.verdict;
  summary.textContent = result.summary;

  // Per-activity Go window. Previously this required BOTH activities to be Go,
  // so a perfect swimming day with surge-y freediving showed nothing at all.
  if (showWindows && dayHours.length) {
    const win = findBestWindow(dayHours, activity);
    const label = formatWindow(win, dayHours);
    windowEl.textContent = label ? `Best ${label}` : '';
    windowEl.hidden = !label;
  } else {
    windowEl.hidden = true;
  }

  card.classList.remove('animating-in');
  void card.offsetWidth; // force reflow so the animation replays
  card.classList.add('animating-in');
}

/**
 * The three numbers a swimmer actually checks before leaving the house.
 * Wave height was already buried in a detail sheet; water temperature and wind
 * direction were fetched or ignored entirely.
 */
function renderConditionsBar(hour, swim) {
  const waveEl  = document.getElementById('cond-wave');
  const tempEl  = document.getElementById('cond-temp');
  const windEl  = document.getElementById('cond-wind');
  const labelEl = document.getElementById('cond-wind-label');
  const arrowEl = document.getElementById('wind-arrow');

  waveEl.textContent = hour.wave_height == null ? '—' : `${hour.wave_height.toFixed(1)}m`;
  tempEl.textContent = hour.sea_surface_temperature == null
    ? '—'
    : `${Math.round(hour.sea_surface_temperature)}°`;

  windEl.textContent = hour.windspeed_10m == null ? '—' : `${Math.round(hour.windspeed_10m)}`;

  const relation = swim.factors.windRelation;
  labelEl.textContent = relation === 'unknown' ? 'km/h wind' : `km/h ${relation}`;
  labelEl.dataset.relation = relation;

  // Meteorological bearings say where wind comes FROM; the arrow shows where it
  // is going, which is what you picture standing on the sand. Hence +180°.
  if (hour.winddirection_10m == null) {
    arrowEl.style.opacity = '0.25';
    arrowEl.style.transform = '';
  } else {
    arrowEl.style.opacity = '1';
    arrowEl.style.transform = `rotate(${(hour.winddirection_10m + 180) % 360}deg)`;
  }
}

/** Tint the whole screen with the better of the two verdicts. */
function setAmbient(swimVerdict, diveVerdict) {
  const rank = { Unknown: -1, No: 0, Sketchy: 1, Go: 2 };
  const best = rank[swimVerdict] >= rank[diveVerdict] ? swimVerdict : diveVerdict;
  const panel = document.getElementById('tab-conditions');
  // Unknown gets no ambient colour: there is nothing to signal.
  if (best === 'Unknown') panel.removeAttribute('data-ambient');
  else panel.dataset.ambient = best;
}

export function getSwimResult() { return currentSwim; }
export function getDiveResult() { return currentDive; }
export function getCurrentHour() { return currentHour; }

export function showSkeletons() {
  ['card-swimming', 'card-freediving'].forEach(id => {
    const card = document.getElementById(id);
    card.classList.add('skeleton-loading');
    card.removeAttribute('data-verdict');
  });
  ['swim-verdict', 'dive-verdict'].forEach(id => { document.getElementById(id).textContent = '—'; });
  ['swim-summary', 'dive-summary'].forEach(id => { document.getElementById(id).textContent = 'Loading…'; });
  ['swim-window', 'dive-window'].forEach(id => { document.getElementById(id).hidden = true; });
  ['cond-wave', 'cond-temp', 'cond-wind'].forEach(id => { document.getElementById(id).textContent = '—'; });
  document.getElementById('tab-conditions').removeAttribute('data-ambient');
}
