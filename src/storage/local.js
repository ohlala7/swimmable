const KEY_SPOTS    = 'swimmable_spots';
const KEY_LOCATION = 'swimmable_last_location';

export function getSavedSpots() {
  try { return JSON.parse(localStorage.getItem(KEY_SPOTS) || '[]'); }
  catch { return []; }
}

export function saveSpot(spot) {
  const spots = getSavedSpots();
  const exists = spots.some(s => s.lat === spot.lat && s.lon === spot.lon);
  if (!exists) spots.push(spot);
  localStorage.setItem(KEY_SPOTS, JSON.stringify(spots));
  return spots;
}

export function removeSpot(lat, lon) {
  const spots = getSavedSpots().filter(s => !(s.lat === lat && s.lon === lon));
  localStorage.setItem(KEY_SPOTS, JSON.stringify(spots));
  return spots;
}

export function isSpotSaved(lat, lon) {
  return getSavedSpots().some(s => s.lat === lat && s.lon === lon);
}

export function getLastLocation() {
  try { return JSON.parse(localStorage.getItem(KEY_LOCATION)); }
  catch { return null; }
}

export function setLastLocation(loc) {
  localStorage.setItem(KEY_LOCATION, JSON.stringify(loc));
}
