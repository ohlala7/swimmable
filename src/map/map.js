import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
const DEFAULT_CENTER = [34.7818, 32.0853]; // Tel Aviv [lng, lat]
const DEFAULT_ZOOM   = 12;

let map = null;
let pinMarker = null;
let locationMarker = null;
let onPinCallback = null;

export function initMap(onPinDrop) {
  onPinCallback = onPinDrop;

  map = new maplibregl.Map({
    container: 'map',
    style: STYLE,
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    attributionControl: true,
    logoPosition: 'bottom-right',
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

  // Tap/click on map → drop pin
  map.on('click', e => {
    dropPin(e.lngLat.lat, e.lngLat.lng);
  });

  // Long-press on mobile → drop pin
  let pressTimer = null;
  map.on('touchstart', e => {
    pressTimer = setTimeout(() => {
      const touch = e.lngLat;
      dropPin(touch.lat, touch.lng);
      navigator.vibrate?.(40);
    }, 400);
  });
  map.on('touchend',   () => clearTimeout(pressTimer));
  map.on('touchmove',  () => clearTimeout(pressTimer));

  return map;
}

function dropPin(lat, lng) {
  if (pinMarker) pinMarker.remove();

  const el = document.createElement('div');
  el.className = 'map-pin map-pin-dropping';

  pinMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([lng, lat])
    .addTo(map);

  onPinCallback?.({ lat, lon: lng });
}

export function flyTo(lat, lon, zoom = 13) {
  map?.flyTo({ center: [lon, lat], zoom, speed: 1.4, curve: 1.42 });
}

export function setLocationDot(lat, lon) {
  if (locationMarker) locationMarker.remove();

  const el = document.createElement('div');
  el.className = 'map-marker-dot';

  locationMarker = new maplibregl.Marker({ element: el })
    .setLngLat([lon, lat])
    .addTo(map);
}

export function clearPin() {
  pinMarker?.remove();
  pinMarker = null;
}

export function getMap() { return map; }
