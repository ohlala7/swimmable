// CSS imports — Vite bundles these
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/verdict.css';
import './styles/animations.css';
import './styles/sheet.css';
import './styles/map.css';

import { state, setState, subscribe }      from './state.js';
import { getLastLocation, setLastLocation, getSavedSpots, saveSpot, removeSpot, isSpotSaved } from './storage/local.js';
import { fetchForecast, sliceByDay, currentHourFor } from './forecast/openmeteo.js';
import { getGPSPosition }                  from './location/gps.js';
import { reverseGeocode }                  from './location/geocode.js';
import { initSearch }                      from './location/search.js';
// map.js is lazy-loaded when the Map tab first opens (MapLibre is 800KB)
let mapFns = null; // { initMap, flyTo, setLocationDot, clearPin }

import { initTabs, switchTab }             from './ui/tabs.js';
import { renderVerdicts, showSkeletons, getSwimResult, getDiveResult, getCurrentHour } from './ui/verdict.js';
import { renderDaySelector, updateActivePill } from './ui/daySelector.js';
import { renderHourlyStrip }               from './ui/hourly.js';
import { initDetailSheet, openDetailSheet } from './ui/sheet.js';
import { renderSavedTab }                  from './ui/saved.js';

let mapInstance = null;
let dayBuckets  = [];
// The spot's UTC offset, from the API. Needed because Open-Meteo returns local
// times with no offset, which the browser would otherwise read in ITS timezone.
let utcOffset   = 0;

// Default fallback location so the app is never stuck on empty skeletons
const FALLBACK_LOCATION = { lat: 32.0853, lon: 34.7818, name: 'Tel Aviv Beach' };

// ── Boot ────────────────────────────────────────────────────────────────────

async function boot() {
  initTabs(onTabChange);
  initDetailSheet();
  initDetailCardListeners();
  initSaveButton();
  showSkeletons();
  setState({ savedSpots: getSavedSpots() });

  const last = getLastLocation();

  if (last) {
    // Load saved location instantly, then silently update with GPS in background
    await loadLocation(last, false);
    getGPSPosition()
      .then(pos => reverseGeocode(pos.lat, pos.lon).then(name => loadLocation({ ...pos, name }, false)))
      .catch(() => {});
  } else {
    // No history: race GPS against a 5-second timeout, then fall back to Tel Aviv
    try {
      const pos = await Promise.race([
        getGPSPosition(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
      const name = await reverseGeocode(pos.lat, pos.lon);
      await loadLocation({ ...pos, name }, false);
    } catch {
      await loadLocation(FALLBACK_LOCATION, false);
    }
  }

  updateSaveButtonState();
}

// ── Location loading ─────────────────────────────────────────────────────────

async function loadLocation(loc, flyToIt = true) {
  setState({ location: loc, loading: true, selectedDay: 0 });
  setLastLocation(loc);

  // Update location chip
  const nameEl = document.getElementById('location-name');
  nameEl.textContent = loc.name;
  nameEl.classList.add('updating');
  nameEl.addEventListener('animationend', () => nameEl.classList.remove('updating'), { once: true });

  // Update map if it's been initialised
  if (mapInstance && flyToIt) {
    mapFns.flyTo(loc.lat, loc.lon);
    mapFns.setLocationDot(loc.lat, loc.lon);
  }

  showSkeletons();

  try {
    const { hourly, utcOffsetSeconds } = await fetchForecast(loc.lat, loc.lon);
    utcOffset = utcOffsetSeconds;
    dayBuckets = sliceByDay(hourly);
    setState({ hourly, loading: false });
    renderDay(0);
  } catch (err) {
    setState({ loading: false, error: err.message });
    showError('Unable to load conditions. Check your connection.');
  }

  updateSaveButtonState();
}

function renderDay(dayIndex) {
  setState({ selectedDay: dayIndex });
  const hours = dayBuckets[dayIndex] ?? [];
  if (!hours.length) return;

  // Resolve "now" in the SPOT's timezone, not the browser's.
  const currentHour = currentHourFor(hours, dayIndex, utcOffset);
  if (!currentHour) return;

  // Go windows are shown for future days only: a window that already passed is
  // noise, and today's remaining hours are visible in the strip anyway.
  renderVerdicts(currentHour, hours, dayIndex > 0);
  renderHourlyStrip(hours, currentHour.time);
  renderDaySelector(dayBuckets, dayIndex, onDaySelect);

  document.getElementById('data-timestamp').textContent =
    `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function onDaySelect(dayIndex) {
  updateActivePill(dayIndex);
  const stack = document.getElementById('verdict-stack');
  stack.classList.add('day-switching');
  renderDay(dayIndex);
  stack.addEventListener('animationend', () => stack.classList.remove('day-switching'), { once: true });
}

// ── Detail sheet ─────────────────────────────────────────────────────────────

function initDetailCardListeners() {
  ['card-swimming', 'card-freediving'].forEach(id => {
    const card = document.getElementById(id);
    card.addEventListener('click', () => openCard(card.dataset.activity));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(card.dataset.activity); }
    });
  });
}

function openCard(activity) {
  const result = activity === 'swimming' ? getSwimResult() : getDiveResult();
  const hour   = getCurrentHour();
  if (!result || !hour) return;
  const label  = activity === 'swimming' ? 'Swimming' : 'Freediving';
  openDetailSheet(label, hour, result, null /* no cam wired up yet */);
}

// ── Save button ───────────────────────────────────────────────────────────────

function initSaveButton() {
  document.getElementById('save-spot-btn').addEventListener('click', toggleSaveSpot);
}

function toggleSaveSpot() {
  const loc = state.location;
  if (!loc) return;

  let spots;
  if (isSpotSaved(loc.lat, loc.lon)) {
    spots = removeSpot(loc.lat, loc.lon);
  } else {
    spots = saveSpot(loc);
    navigator.vibrate?.(30);
  }

  setState({ savedSpots: spots });
  updateSaveButtonState();
}

function updateSaveButtonState() {
  const btn = document.getElementById('save-spot-btn');
  const loc = state.location;
  const saved = loc ? isSpotSaved(loc.lat, loc.lon) : false;
  btn.setAttribute('aria-pressed', saved);
}

// ── Tab changes ───────────────────────────────────────────────────────────────

function onTabChange(tab) {
  if (tab === 'map' && !mapInstance) {
    // Lazy-load MapLibre only when the Map tab first opens
    import('./map/map.js').then(mod => {
      mapFns = mod;
      mapInstance = mod.initMap(onMapPin);
      if (state.location) {
        mod.flyTo(state.location.lat, state.location.lon);
        mod.setLocationDot(state.location.lat, state.location.lon);
      }
      initSearch(onSearchSelect);
      initMapButtons();
    });
  }

  if (tab === 'saved') {
    renderSavedTab(spot => {
      loadLocation(spot, true);
      switchTab('conditions', onTabChange);
    });
  }
}

function initMapButtons() {
  document.getElementById('gps-btn').addEventListener('click', async () => {
    try {
      const pos  = await getGPSPosition();
      const name = await reverseGeocode(pos.lat, pos.lon);
      document.getElementById('sheet-location-name').textContent = name;
      document.getElementById('btn-use-location').disabled = false;
      document.getElementById('btn-use-location').dataset.lat = pos.lat;
      document.getElementById('btn-use-location').dataset.lon = pos.lon;
      document.getElementById('btn-use-location').dataset.name = name;
      mapFns?.flyTo(pos.lat, pos.lon);
      mapFns?.setLocationDot(pos.lat, pos.lon);
      document.getElementById('location-sheet').classList.add('expanded');
    } catch (err) {
      document.getElementById('sheet-location-name').textContent = err.message;
    }
  });

  document.getElementById('btn-use-gps').addEventListener('click', async () => {
    try {
      const pos  = await getGPSPosition();
      const name = await reverseGeocode(pos.lat, pos.lon);
      await loadLocation({ ...pos, name }, true);
      switchTab('conditions', onTabChange);
    } catch (err) {
      showError(err.message);
    }
  });

  document.getElementById('btn-use-location').addEventListener('click', () => {
    const btn  = document.getElementById('btn-use-location');
    const lat  = parseFloat(btn.dataset.lat);
    const lon  = parseFloat(btn.dataset.lon);
    const name = btn.dataset.name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    if (isNaN(lat) || isNaN(lon)) return;
    loadLocation({ lat, lon, name }, false);
    switchTab('conditions', onTabChange);
    document.getElementById('location-sheet').classList.remove('expanded');
  });
}

function onMapPin({ lat, lon }) {
  reverseGeocode(lat, lon).then(name => {
    const sheet  = document.getElementById('location-sheet');
    const nameEl = document.getElementById('sheet-location-name');
    const useBtn = document.getElementById('btn-use-location');

    nameEl.textContent = name;
    useBtn.disabled = false;
    useBtn.dataset.lat  = lat;
    useBtn.dataset.lon  = lon;
    useBtn.dataset.name = name;
    sheet.classList.add('expanded');
  });
}

function onSearchSelect(item) {
  mapFns?.clearPin();
  mapFns?.flyTo(item.lat, item.lon, 13);
  mapFns?.setLocationDot(item.lat, item.lon);
  document.getElementById('sheet-location-name').textContent = item.name;
  document.getElementById('btn-use-location').disabled = false;
  document.getElementById('btn-use-location').dataset.lat  = item.lat;
  document.getElementById('btn-use-location').dataset.lon  = item.lon;
  document.getElementById('btn-use-location').dataset.name = item.name;
  document.getElementById('location-sheet').classList.add('expanded');
}

// Location chip tap → go to map tab
document.getElementById('location-chip').addEventListener('click', () => {
  switchTab('map', onTabChange);
});

// ── Utility ───────────────────────────────────────────────────────────────────

function showError(message) {
  document.getElementById('swim-summary').textContent = message;
  document.getElementById('dive-summary').textContent = '';
}

// ── Start ─────────────────────────────────────────────────────────────────────
boot();
