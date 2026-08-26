export const state = {
  location: null,       // { lat, lon, name }
  hourly: null,         // array of combined hourly records (7 days)
  selectedDay: 0,       // index 0=today
  activeTab: 'conditions',
  savedSpots: [],
  loading: false,
  error: null,
};

const listeners = new Set();

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach(fn => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
