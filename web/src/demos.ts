export const VARIABLES = ['T2M', 'PRECTOTCORR', 'WS2M'] as const;
export type VariableName = (typeof VARIABLES)[number];
