export interface Landmark {
  name: string;
  lat: number;
  lng: number;
}

/** Reference landmarks (real coordinates) used for texture-alignment debugging. */
export const LANDMARKS: Landmark[] = [
  { name: '0N 0E', lat: 0, lng: 0 },
  { name: 'Istanbul', lat: 41.01, lng: 28.97 },
  { name: 'Sydney', lat: -33.87, lng: 151.21 },
  { name: 'New York', lat: 40.71, lng: -74.01 },
];
