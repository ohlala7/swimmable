const MARINE_URL  = 'https://marine-api.open-meteo.com/v1/marine';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';

const MARINE_VARS = [
  'wave_height', 'wave_period', 'wave_direction',
  'swell_wave_height', 'swell_wave_period', 'swell_wave_direction',
  'wind_wave_height', 'wind_wave_period',
  'sea_surface_temperature',
].join(',');

const WEATHER_VARS = [
  'windspeed_10m', 'windgusts_10m', 'winddirection_10m',
  'weathercode', 'precipitation',
].join(',');

/**
 * Fetch 7 days of hourly marine + weather data for a location.
 *
 * @returns {Promise<{ hourly: object[], utcOffsetSeconds: number, timezone: string }>}
 *
 * Note we return the API's utc_offset_seconds alongside the data. Open-Meteo is
 * called with timezone=auto, so every `time` string is local to the SPOT and
 * carries no offset ("2026-08-26T14:00"). Passing that to `new Date()` makes the
 * browser interpret it in the USER's timezone, which silently selects the wrong
 * hour whenever the two differ. The offset lets us resolve "now" correctly.
 */
export async function fetchForecast(lat, lon) {
  const params = `latitude=${lat}&longitude=${lon}&forecast_days=7&timezone=auto`;

  const [marineRes, weatherRes] = await Promise.all([
    fetch(`${MARINE_URL}?${params}&hourly=${MARINE_VARS}`),
    fetch(`${WEATHER_URL}?${params}&hourly=${WEATHER_VARS}`),
  ]);

  if (!marineRes.ok)  throw new Error(`Marine API error ${marineRes.status}`);
  if (!weatherRes.ok) throw new Error(`Weather API error ${weatherRes.status}`);

  const [marine, weather] = await Promise.all([marineRes.json(), weatherRes.json()]);

  return {
    hourly: mergeHourly(marine.hourly, weather.hourly),
    utcOffsetSeconds: marine.utc_offset_seconds ?? weather.utc_offset_seconds ?? 0,
    timezone: marine.timezone ?? weather.timezone ?? 'UTC',
  };
}

/**
 * Merge the two API responses index-by-index.
 *
 * Missing values become null rather than a fabricated default. The old code
 * defaulted absent readings to 0 (or 6s), which is indistinguishable from a real
 * flat-calm reading — an API gap silently scored as perfect conditions. The
 * scorer now decides what to do with null explicitly.
 */
function mergeHourly(marine, weather) {
  const times = marine.time;

  // Weather and marine grids can differ in length near the forecast horizon;
  // index by timestamp so a shorter array can never shift the other's values.
  const weatherIndex = new Map(weather.time.map((t, i) => [t, i]));

  return times.map((time, i) => {
    const w = weatherIndex.get(time);
    return {
      time,
      wave_height:             marine.wave_height?.[i]             ?? null,
      wave_period:             marine.wave_period?.[i]             ?? null,
      wave_direction:          marine.wave_direction?.[i]          ?? null,
      swell_wave_height:       marine.swell_wave_height?.[i]       ?? null,
      swell_wave_period:       marine.swell_wave_period?.[i]       ?? null,
      swell_wave_direction:    marine.swell_wave_direction?.[i]    ?? null,
      wind_wave_height:        marine.wind_wave_height?.[i]        ?? null,
      wind_wave_period:        marine.wind_wave_period?.[i]        ?? null,
      sea_surface_temperature: marine.sea_surface_temperature?.[i] ?? null,
      windspeed_10m:      w != null ? weather.windspeed_10m?.[w]      ?? null : null,
      windgusts_10m:      w != null ? weather.windgusts_10m?.[w]      ?? null : null,
      winddirection_10m:  w != null ? weather.winddirection_10m?.[w]  ?? null : null,
      weathercode:        w != null ? weather.weathercode?.[w]        ?? 0    : 0,
      precipitation:      w != null ? weather.precipitation?.[w]      ?? 0    : 0,
    };
  });
}

/**
 * Slice an hourly array into day buckets aligned to midnight in the API timezone.
 * Returns an array of up to 7 arrays, each containing hourly records for that day.
 */
export function sliceByDay(hourly) {
  const days = [];
  let current = [];
  let currentDate = null;

  for (const h of hourly) {
    const date = h.time.slice(0, 10); // "YYYY-MM-DD"
    if (date !== currentDate) {
      if (current.length) days.push(current);
      current = [h];
      currentDate = date;
    } else {
      current.push(h);
    }
  }
  if (current.length) days.push(current);
  return days;
}

/**
 * The current wall-clock time AT THE SPOT, as an "YYYY-MM-DDTHH:00" string that
 * can be compared directly against Open-Meteo's `time` values.
 *
 * Shifting by the spot's UTC offset and then reading UTC fields gives the spot's
 * local time without ever constructing a Date in the browser's timezone.
 */
export function nowAtSpot(utcOffsetSeconds) {
  const shifted = new Date(Date.now() + utcOffsetSeconds * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:00`;
}

/**
 * The hour record to treat as "current" for a day.
 * For today: the first hour at or after the spot's local time. For future days:
 * the first hour that is a sensible time to be in the water.
 */
export function currentHourFor(dayHours, dayIndex, utcOffsetSeconds) {
  if (!dayHours.length) return null;
  if (dayIndex > 0) {
    return dayHours.find(h => parseInt(h.time.slice(11, 13), 10) >= 8) ?? dayHours[0];
  }
  const now = nowAtSpot(utcOffsetSeconds);
  return dayHours.find(h => h.time >= now) ?? dayHours[dayHours.length - 1];
}

/** Format an hour number (0–23) as a short label, e.g. 14 → "2pm" */
export function formatHourNumber(h) {
  if (h === 0)  return '12am';
  if (h < 12)   return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

/**
 * Format an ISO time string to a short hour label, e.g. "…T14:00" → "2pm"
 */
export function formatHour(isoTime) {
  return formatHourNumber(parseInt(isoTime.slice(11, 13), 10));
}

/**
 * Format a best window into a readable range, e.g. "7am–10am".
 *
 * A window covering hours 7,8,9 runs until 10:00, so the end label is one hour
 * past the last Go hour. The previous version clamped that index to the last
 * element of the array, which silently understated any window running to the end
 * of the day ("…–11pm" for a window that actually reached midnight).
 */
export function formatWindow(window, dayHours) {
  if (!window) return null;

  // A window spanning essentially the whole forecast day should say so. Rendering
  // it as "12am–midnight" is technically accurate and reads like a bug.
  if (window.durationH >= dayHours.length && dayHours.length >= 20) return 'all day';

  const start = formatHour(dayHours[window.startHour].time);
  const lastHour = parseInt(dayHours[window.endHour].time.slice(11, 13), 10);
  const endHour = (lastHour + 1) % 24;
  const end = endHour === 0 ? 'midnight' : formatHourNumber(endHour);
  return `${start}–${end}`;
}
