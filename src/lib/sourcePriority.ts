import type { AtmosphericScenario, TimeHorizon } from './classifyScenario';

export interface SourcePriority {
  primary: string[];
  secondary: string[];
  ignore: string[];
}

export const SOURCE_MATRIX: Record<AtmosphericScenario, Record<TimeHorizon, SourcePriority>> = {
  storm_active: {
    nowcast:    { primary: ['radar','glm','surfaceObs'],        secondary: ['hrrr','alerts'],     ignore: ['ensemble','day48'] },
    shortrange: { primary: ['radar','glm','hrrr','md'],         secondary: ['spcDay1','alerts'],  ignore: ['ensemble','day48'] },
    nearterm:   { primary: ['hrrr','spcDay1','md','alerts'],    secondary: ['radar','sounding'],  ignore: ['ensemble'] },
    medrange:   { primary: ['spcDay2','spcDay3','multiModel'],  secondary: ['ensemble'],          ignore: ['radar','glm'] },
    extended:   { primary: ['ensemble','spcDay48'],             secondary: ['multiModel'],        ignore: ['radar','glm','md'] },
  },
  storm_imminent: {
    nowcast:    { primary: ['radar','glm','surfaceObs'],        secondary: ['hrrr'],              ignore: ['ensemble','afd'] },
    shortrange: { primary: ['radar','hrrr','md'],               secondary: ['spcDay1','glm'],     ignore: ['ensemble'] },
    nearterm:   { primary: ['hrrr','spcDay1','afd'],            secondary: ['multiModel'],        ignore: ['ensemble','day48'] },
    medrange:   { primary: ['multiModel','spcDay2','spcDay3'],  secondary: ['ensemble'],          ignore: ['radar','glm'] },
    extended:   { primary: ['ensemble','spcDay48'],             secondary: ['multiModel'],        ignore: ['radar','glm'] },
  },
  convective_setup: {
    nowcast:    { primary: ['sounding','hrrr','surfaceObs'],    secondary: ['radar','glm'],       ignore: ['ensemble'] },
    shortrange: { primary: ['hrrr','sounding','md'],            secondary: ['spcDay1'],           ignore: ['ensemble','day48'] },
    nearterm:   { primary: ['hrrr','spcDay1','afd','sounding'], secondary: ['multiModel'],        ignore: ['ensemble'] },
    medrange:   { primary: ['spcDay2','spcDay3','multiModel'],  secondary: ['ensemble'],          ignore: ['sounding','radar'] },
    extended:   { primary: ['ensemble','spcDay48'],             secondary: ['multiModel'],        ignore: ['sounding'] },
  },
  organized_severe: {
    nowcast:    { primary: ['radar','glm','alerts','md'],       secondary: ['sounding','hrrr'],   ignore: ['ensemble'] },
    shortrange: { primary: ['radar','md','spcDay1','hrrr'],     secondary: ['sounding','alerts'], ignore: ['ensemble'] },
    nearterm:   { primary: ['spcDay1','md','hrrr','afd'],       secondary: ['sounding','multiModel'], ignore: ['ensemble','day48'] },
    medrange:   { primary: ['spcDay2','spcDay3','multiModel'],  secondary: ['ensemble'],          ignore: ['radar','glm'] },
    extended:   { primary: ['ensemble','spcDay48'],             secondary: ['multiModel'],        ignore: ['radar','glm'] },
  },
  flash_flood: {
    nowcast:    { primary: ['radar','surfaceObs','glm'],        secondary: ['hrrr','alerts'],     ignore: ['sounding','ensemble'] },
    shortrange: { primary: ['hrrr','wpcEro','radar'],           secondary: ['alerts','satellite'], ignore: ['ensemble'] },
    nearterm:   { primary: ['hrrr','wpcEro','afd'],             secondary: ['multiModel','spcDay1'], ignore: ['ensemble','day48'] },
    medrange:   { primary: ['wpcEro','multiModel'],             secondary: ['ensemble'],          ignore: ['radar','glm'] },
    extended:   { primary: ['ensemble'],                        secondary: ['multiModel'],        ignore: ['radar','glm','wpcEro'] },
  },
  fog_visibility: {
    nowcast:    { primary: ['surfaceObs','hrrr'],               secondary: ['sounding','satellite'], ignore: ['radar','glm','spc'] },
    shortrange: { primary: ['hrrr','surfaceObs','sounding'],    secondary: ['afd'],               ignore: ['radar','glm','spc'] },
    nearterm:   { primary: ['hrrr','afd'],                      secondary: ['multiModel'],        ignore: ['radar','glm','spc'] },
    medrange:   { primary: ['multiModel','afd'],                secondary: ['ensemble'],          ignore: ['radar','glm'] },
    extended:   { primary: ['ensemble'],                        secondary: ['afd'],               ignore: ['radar','glm'] },
  },
  tropical: {
    nowcast:    { primary: ['alerts','radar','glm','surfaceObs'], secondary: ['hrrr','marine'],   ignore: ['spc','drought'] },
    shortrange: { primary: ['alerts','hrrr','radar','marine'],    secondary: ['afd'],             ignore: ['spc','drought'] },
    nearterm:   { primary: ['alerts','hrrr','afd','marine'],      secondary: ['multiModel'],      ignore: ['spc'] },
    medrange:   { primary: ['alerts','multiModel','ensemble'],    secondary: ['afd','marine'],    ignore: ['spc'] },
    extended:   { primary: ['alerts','ensemble'],                 secondary: ['multiModel'],      ignore: ['radar','glm'] },
  },
  fire_weather: {
    nowcast:    { primary: ['fireWeather','surfaceObs'],         secondary: ['fireOutlook','drought'], ignore: ['radar','marine'] },
    shortrange: { primary: ['fireWeather','hrrr','fireOutlook'], secondary: ['drought'],          ignore: ['marine','spc'] },
    nearterm:   { primary: ['fireOutlook','hrrr','afd'],         secondary: ['drought','multiModel'], ignore: ['marine'] },
    medrange:   { primary: ['fireOutlook','multiModel'],         secondary: ['ensemble','drought'], ignore: ['marine'] },
    extended:   { primary: ['ensemble','fireOutlook'],           secondary: ['drought'],          ignore: ['marine','radar'] },
  },
  winter: {
    nowcast:    { primary: ['surfaceObs','radar','hrrr'],       secondary: ['sounding','alerts'], ignore: ['glm','spc','marine'] },
    shortrange: { primary: ['hrrr','sounding','radar'],         secondary: ['afd','alerts'],      ignore: ['glm','spc'] },
    nearterm:   { primary: ['hrrr','afd','multiModel'],         secondary: ['sounding','alerts'], ignore: ['glm','spc'] },
    medrange:   { primary: ['multiModel','afd','ensemble'],     secondary: ['alerts'],            ignore: ['glm','radar'] },
    extended:   { primary: ['ensemble','multiModel'],           secondary: ['afd'],               ignore: ['glm','radar'] },
  },
  benign: {
    nowcast:    { primary: ['surfaceObs','hrrr'],               secondary: ['afd'],               ignore: ['radar','glm','spc','ensemble'] },
    shortrange: { primary: ['hrrr','afd'],                      secondary: ['multiModel'],        ignore: ['radar','glm','spc'] },
    nearterm:   { primary: ['hrrr','afd','multiModel'],         secondary: ['spcDay1'],           ignore: ['radar','glm'] },
    medrange:   { primary: ['multiModel','afd'],                secondary: ['ensemble','spcDay2'], ignore: ['radar','glm'] },
    extended:   { primary: ['ensemble','spcDay48'],             secondary: ['multiModel'],        ignore: ['radar','glm','md'] },
  },
};

export function getSourcePriority(scenario: AtmosphericScenario, horizon: TimeHorizon): SourcePriority {
  return SOURCE_MATRIX[scenario][horizon];
}