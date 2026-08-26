/**
 * Request the user's GPS position.
 * Returns a Promise that resolves to { lat, lon }.
 * Throws with a user-readable message on failure.
 */
export function getGPSPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation is not supported on this device.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => {
        const messages = {
          1: 'Location access denied. Allow location in your browser settings.',
          2: 'Unable to determine your location. Check your connection.',
          3: 'Location request timed out. Try again.',
        };
        reject(new Error(messages[err.code] || 'Location unavailable.'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}
