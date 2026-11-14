/** The variables of the site, in picker order, grouped as the picker shows them (pipeline/config.py has the same groups). */
export const VARIABLE_GROUPS = [
  { name: 'Temperature', variables: ['T2M', 'T2M_MAX'] },
  { name: 'Water', variables: ['PRECTOTCORR', 'GWETROOT', 'EVLAND', 'RH2M'] },
  { name: 'Ice & snow', variables: ['FRSNO', 'FRSEAICE'] },
  { name: 'Air', variables: ['WS2M', 'TO3'] },
] as const;

export const VARIABLES = ['T2M', 'T2M_MAX', 'PRECTOTCORR', 'GWETROOT', 'EVLAND', 'RH2M', 'FRSNO', 'FRSEAICE', 'WS2M', 'TO3'] as const;
export type VariableName = (typeof VARIABLES)[number];
