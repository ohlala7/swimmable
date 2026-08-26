import { waterTempAdvisory, wavelength } from '../forecast/score.js';

/**
 * Detail sheet — slides up when a verdict card is tapped.
 * Shows wave height, the summary, why the verdict came out that way, and the
 * supporting facts that did not warrant their own line.
 */
export function initDetailSheet() {
  document.getElementById('detail-close').addEventListener('click', closeDetailSheet);
  document.getElementById('detail-backdrop').addEventListener('click', closeDetailSheet);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('detail-sheet').hidden) closeDetailSheet();
  });

  // Swipe down to dismiss
  let startY = null;
  const panel = document.querySelector('.detail-panel');
  panel.addEventListener('touchstart', e => {
    // Only start a dismiss drag from the top of a scrolled panel, otherwise the
    // gesture fights with scrolling the factor list.
    startY = panel.scrollTop <= 0 ? e.touches[0].clientY : null;
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - (startY ?? 0);
    panel.style.transform = '';
    startY = null;
    if (dy > 80) closeDetailSheet();
  });
}

export function openDetailSheet(activity, hour, result, camUrl) {
  const sheet = document.getElementById('detail-sheet');

  document.getElementById('detail-activity').textContent = activity;
  document.getElementById('detail-wave-num').textContent = (hour.wave_height ?? 0).toFixed(1);
  document.getElementById('detail-summary').textContent = result.summary;

  renderFactors(result.factors);
  renderMeta(hour, result);

  const camBtn = document.getElementById('btn-cam');
  camBtn.hidden = !camUrl;
  camBtn.href = camUrl || '#';

  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
}

/**
 * Why this verdict. Bars show how much of each factor's quality survived — full
 * bar means that factor is not holding you back. The limiting factor is
 * highlighted, which is the same value the summary sentence is generated from,
 * so the text and the chart can never disagree.
 */
function renderFactors(factors) {
  const list = document.getElementById('factor-list');
  list.innerHTML = '';

  // With no marine coverage every cost is zero, which would draw three full bars
  // and imply "nothing is holding you back" — the exact false confidence the
  // Unknown verdict exists to avoid. Show nothing instead.
  if (!factors.hasMarineData) return;

  const rows = [
    ['Swell', 100 - factors.swellCost, 'swell'],
    ['Chop',  100 - factors.chopCost,  'chop'],
    ['Wind',  100 - factors.windCost,  'wind'],
  ];

  for (const [name, value, key] of rows) {
    const li = document.createElement('li');
    li.className = 'factor-row';
    li.dataset.limiting = String(factors.limiting === key);

    const label = document.createElement('span');
    label.className = 'factor-name';
    label.textContent = name;

    const track = document.createElement('div');
    track.className = 'factor-track';
    const fill = document.createElement('div');
    fill.className = 'factor-fill';
    fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    track.appendChild(fill);

    const note = document.createElement('span');
    note.className = 'factor-note';
    note.textContent = factors.limiting === key ? 'limiting' : '';

    li.append(label, track, note);
    list.appendChild(li);
  }
}

/** Supporting facts: water temperature, wind relation, swell geometry. */
function renderMeta(hour, result) {
  const meta = document.getElementById('detail-meta');
  meta.innerHTML = '';

  const chips = [];

  const temp = waterTempAdvisory(hour.sea_surface_temperature);
  if (temp) {
    chips.push([
      `${Math.round(hour.sea_surface_temperature)}° — ${temp.text}`,
      temp.level === 'extreme' ? 'danger' : temp.level === 'cold' ? 'warn' : 'good',
    ]);
  }

  const relation = result.factors.windRelation;
  if (relation !== 'unknown') {
    chips.push([
      `${Math.round(hour.windspeed_10m ?? 0)} km/h ${relation}`,
      result.factors.offshoreDrift ? 'danger' : relation === 'offshore' ? 'good' : 'neutral',
    ]);
  }

  if (hour.windgusts_10m != null && hour.windspeed_10m > 0) {
    chips.push([`gusting ${Math.round(hour.windgusts_10m)} km/h`, 'neutral']);
  }

  if (hour.swell_wave_period != null) {
    chips.push([
      `${Math.round(hour.swell_wave_period)}s swell · ${wavelength(hour.swell_wave_period)}m wavelength`,
      'neutral',
    ]);
  }

  for (const [text, tone] of chips) {
    const chip = document.createElement('span');
    chip.className = 'meta-chip';
    if (tone !== 'neutral') chip.dataset.tone = tone;
    chip.textContent = text;
    meta.appendChild(chip);
  }
}

export function closeDetailSheet() {
  document.getElementById('detail-sheet').hidden = true;
  document.body.style.overflow = '';
}
