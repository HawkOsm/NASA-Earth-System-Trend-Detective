export const VARIABLES = ['T2M', 'PRECTOTCORR', 'WS2M'] as const;
export type VariableName = (typeof VARIABLES)[number];

export interface Demo {
  label: string;
  variable: VariableName;
  lat: number;
  lng: number;
}

export const DEMOS: Demo[] = [
  { label: 'Istanbul is warming', variable: 'T2M', lat: 41.01, lng: 28.97 },
  { label: 'Cebu is getting wetter', variable: 'PRECTOTCORR', lat: 10.3, lng: 123.9 },
  { label: 'The Amazon near Porto Velho is getting drier', variable: 'PRECTOTCORR', lat: -8.76, lng: -63.9 },
];
