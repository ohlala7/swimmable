import { getSavedSpots, removeSpot } from '../storage/local.js';
import { fetchForecast, sliceByDay, formatWindow, currentHourFor } from '../forecast/openmeteo.js';
import { scoreSwimming, scoreFreediving, findBestWindow } from '../forecast/score.js';

export function renderSavedTab(onSpotSelect) {
  const list     = document.getElementById('saved-list');
  const empty    = document.getElementById('saved-empty');
  const spots    = getSavedSpots();

  list.innerHTML = '';

  if (!spots.length) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;

  spots.forEach(spot => {
    const li = document.createElement('li');
    li.className = 'saved-item';

    const name = document.createElement('div');
    name.className = 'saved-item-name';
    name.textContent = spot.name;

    const verdicts = document.createElement('div');
    verdicts.className = 'saved-item-verdicts';

    const swimBadge = document.createElement('span');
    swimBadge.className = 'saved-verdict-badge';
    swimBadge.textContent = 'Swim: —';

    const diveBadge = document.createElement('span');
    diveBadge.className = 'saved-verdict-badge';
    diveBadge.textContent = 'Dive: —';

    verdicts.appendChild(swimBadge);
    verdicts.appendChild(diveBadge);

    const window = document.createElement('div');
    window.className = 'saved-item-window';
    window.textContent = 'Loading…';

    li.appendChild(name);
    li.appendChild(verdicts);
    li.appendChild(window);

    li.addEventListener('click', () => onSpotSelect(spot));

    list.appendChild(li);

    // Async load conditions for each spot
    loadSpotConditions(spot, swimBadge, diveBadge, window);
  });
}

async function loadSpotConditions(spot, swimBadge, diveBadge, windowEl) {
  try {
    const { hourly, utcOffsetSeconds } = await fetchForecast(spot.lat, spot.lon);
    const days   = sliceByDay(hourly);
    const today  = days[0] ?? [];
    const tomorrow = days[1] ?? [];

    if (!today.length) return;

    // Resolve "now" at the SPOT — saved spots are frequently in another timezone,
    // which is exactly where the old `new Date(h.time)` comparison went wrong.
    const current = currentHourFor(today, 0, utcOffsetSeconds);
    if (!current) return;

    const swim = scoreSwimming(current);
    const dive = scoreFreediving(current);

    swimBadge.textContent = `Swim: ${swim.verdict}`;
    swimBadge.dataset.verdict = swim.verdict;
    diveBadge.textContent = `Dive: ${dive.verdict}`;
    diveBadge.dataset.verdict = dive.verdict;

    // Best swimming window for tomorrow. Per-activity now: requiring both
    // activities to be Go reported "no window" on plenty of good swim days.
    if (tomorrow.length) {
      const best = findBestWindow(tomorrow, 'swimming');
      windowEl.textContent = best
        ? `Best swim tomorrow: ${formatWindow(best, tomorrow)}`
        : 'No swim window tomorrow';
    } else {
      windowEl.textContent = '';
    }
  } catch {
    swimBadge.textContent = 'Swim: —';
    diveBadge.textContent = 'Dive: —';
    windowEl.textContent = 'Unable to load';
  }
}
