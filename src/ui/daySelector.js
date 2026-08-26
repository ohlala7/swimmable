import { scoreSwimming, scoreFreediving } from '../forecast/score.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function renderDaySelector(dayBuckets, selectedDay, onDaySelect) {
  const container = document.getElementById('day-selector');
  container.innerHTML = '';

  dayBuckets.forEach((hours, i) => {
    const date = new Date(hours[0].time);
    const label = i === 0 ? 'Today' : i === 1 ? 'Tmrw' : DAY_NAMES[date.getDay()];

    // Best verdict for the day = worst of best-hour across both activities
    const bestVerdict = bestDayVerdict(hours);

    const pill = document.createElement('button');
    pill.className = `day-pill${i === selectedDay ? ' active' : ''}`;
    pill.setAttribute('role', 'tab');
    pill.setAttribute('aria-selected', i === selectedDay);
    pill.setAttribute('aria-label', `${label} — ${bestVerdict}`);
    pill.dataset.day = i;

    const labelEl = document.createElement('span');
    labelEl.textContent = label;

    const dot = document.createElement('span');
    dot.className = 'day-pill-dot';
    dot.dataset.verdict = bestVerdict;

    pill.appendChild(labelEl);
    pill.appendChild(dot);
    pill.addEventListener('click', () => onDaySelect(i));
    container.appendChild(pill);
  });
}

export function updateActivePill(selectedDay) {
  document.querySelectorAll('.day-pill').forEach((pill, i) => {
    const isActive = i === selectedDay;
    pill.classList.toggle('active', isActive);
    pill.setAttribute('aria-selected', isActive);
  });
}

const RANK = { Unknown: 0, No: 1, Sketchy: 2, Go: 3 };
const VERDICTS = ['Unknown', 'No', 'Sketchy', 'Go'];

/**
 * The day's dot shows the best verdict reachable at any hour, for either activity.
 *
 * This compares VERDICTS, not raw scores. It used to take the max score and then
 * re-apply its own 72/42 thresholds — a second copy of the cutoffs that silently
 * went stale when the profiles were retuned (swimming is 70, freediving 73), so
 * the dot could disagree with the card directly beneath it.
 */
function bestDayVerdict(hours) {
  let best = 0;
  for (const h of hours) {
    const hourBest = Math.max(RANK[scoreSwimming(h).verdict], RANK[scoreFreediving(h).verdict]);
    if (hourBest > best) best = hourBest;
    if (best === RANK.Go) break; // cannot improve on Go
  }
  return VERDICTS[best];
}
