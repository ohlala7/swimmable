const NOMINATIM = 'https://nominatim.openstreetmap.org';
const HEADERS = {
  'Accept-Language': 'en',
  'User-Agent':      'Swimmable/1.0 (class-indoor.0f@icloud.com)',
};

// Session cache — prevents hammering Nominatim with identical queries
const searchCache = new Map();

/**
 * Forward geocode: search query → array of { lat, lon, name, country } results
 */
export async function geocodeSearch(query) {
  const key = query.trim().toLowerCase();
  if (searchCache.has(key)) return searchCache.get(key);

  const url = `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1&email=class-indoor.0f@icloud.com`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Geocoding error ${res.status}`);

  const data = await res.json();
  const results = data.map(item => ({
    lat:     parseFloat(item.lat),
    lon:     parseFloat(item.lon),
    name:    item.display_name.split(',').slice(0, 2).join(',').trim(),
    country: item.address?.country ?? '',
  }));

  searchCache.set(key, results);
  return results;
}

/**
 * Reverse geocode: { lat, lon } → display name string
 */
export async function reverseGeocode(lat, lon) {
  const url = `${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=json&zoom=16&email=class-indoor.0f@icloud.com`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

  const data = await res.json();
  if (!data.address) return data.display_name?.split(',')[0] ?? 'Unknown location';

  const { beach, tourism, suburb, city, town, village, county } = data.address;
  return beach || tourism || suburb || city || town || village || county || data.display_name.split(',')[0];
}
