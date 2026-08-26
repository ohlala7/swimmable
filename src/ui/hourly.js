import { scoreSwimming, scoreFreediving } from '../forecast/score.js';
import { formatHour } from '../forecast/openmeteo.js';

/**
 * The day as a bar chart: height encodes how good the hour is, colour encodes
 * the verdict, and every third hour is labelled.
 *
 * The previous strip drew a coloured dot plus the word "Skchy" — an abbreviation
 * invented purely to fit the box. A bar carries the score as well as the verdict
 * in less space, and makes the shape of the day (a calm dawn, a blown-out
 * afternoon) legible without reading anything.
 */
export function renderHourlyStrip(hours, currentIso) {
  const strip = document.getElementById('hourly-strip');
  strip.innerHTML = '';

  const frag = document.createDocumentFragment();

  hours.forEach((hour, i) => {
    const swim = scoreSwimming(hour);
    const dive = scoreFreediving(hour);

    // The strip is a single combined read, so take the more conservative verdict:
    // it exists to point you at the good hours, not to arbitrate between activities.
    const verdict = rank(swim.verdict) <= rank(dive.verdict) ? swim.verdict : dive.verdict;
    // Unknown hours carry no score; draw them as a flat, muted bar.
    const score = swim.score == null ? 0 : Math.min(swim.score, dive.score);
    const isCurrent = hour.time === currentIso;

    const item = document.createElement('div');
    item.className = `hourly-item${isCurrent ? ' current-hour' : ''}`;
    item.setAttribute('role', 'listitem');
    item.setAttribute('aria-label', `${formatHour(hour.time)}: ${verdict}`);

    const track = document.createElement('div');
    track.className = 'hourly-bar-track';

    const bar = document.createElement('div');
    bar.className = 'hourly-bar';
    bar.dataset.verdict = verdict;
    // Floor the bar at 6% so a zero-score hour still reads as a bar, not a gap.
    bar.style.height = `${Math.max(6, score)}%`;
    track.appendChild(bar);

    const time = document.createElement('span');
    time.className = 'hourly-time';
    // Label every third hour, plus whichever hour is current, to keep the axis
    // readable on a 360px screen without crowding.
    time.textContent = (i % 3 === 0 || isCurrent) ? formatHour(hour.time) : '';

    item.append(track, time);
    frag.appendChild(item);
  });

  strip.appendChild(frag);

  strip.querySelector('.current-hour')
    ?.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
}

// Unknown sorts below No: an hour we cannot judge must never be presented as
// better than one we have judged and rejected.
function rank(verdict) {
  return { Unknown: -1, No: 0, Sketchy: 1, Go: 2 }[verdict];
}
