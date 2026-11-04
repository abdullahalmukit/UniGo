// Map values used outside the map itself. Kept apart from MapPicker so that
// importing them does not load Leaflet, which only the map pages download.
export type LatLng = { lat: number; lng: number };

// Dhaka, when there is no point yet
export const DEFAULT_CENTER: LatLng = { lat: 23.8103, lng: 90.4125 };
