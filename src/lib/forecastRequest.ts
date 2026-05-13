/**
 * Unified forecast request object. Built once when the user submits a
 * question and passed unchanged through every screen and server function.
 * No layer below the home screen should override `location` or `intent`.
 */

export type ForecastIntent =
  | 'temperature'
  | 'rain_chance'
  | 'storm_risk'
  | 'tornado_risk'
  | 'snow'
  | 'wind'
  | 'heat_index'
  | 'humidity'
  | 'air_quality'
  | 'uv_index'
  | 'visibility'
  | 'fog'
  | 'lightning'
  | 'flooding'
  | 'severe_weather'
  | 'marine'
  | 'aviation'
  | 'outdoor_comfort'
  | 'plan_impact'
  | 'nowcast'
  | 'general';

export interface ForecastRequest {
  rawQuestion: string;
  distilledQuestion: string;
  intent: ForecastIntent;
  location: {
    raw: string;
    display: string;
    lat: number;
    lon: number;
    source: 'question' | 'active_address' | 'gps';
  };
  timeWindow: {
    label: string;
    hoursAhead: number;
    endHoursAhead?: number;
    isoStart?: string;
    isoEnd?: string;
  };
  requestedVariables: string[];
}

/** Map an intent to the meteorological variables we want to highlight. */
export function variablesForIntent(intent: ForecastIntent): string[] {
  switch (intent) {
    case 'temperature':
    case 'heat_index':
      return ['temperature', 'heat_index', 'feels_like'];
    case 'rain_chance':
      return ['precipitation_probability', 'precipitation'];
    case 'storm_risk':
    case 'severe_weather':
    case 'tornado_risk':
    case 'lightning':
      return ['cape', 'lightning', 'wind_gusts', 'radar'];
    case 'wind':
      return ['windspeed', 'wind_gusts', 'wind_direction'];
    case 'humidity':
      return ['humidity', 'dewpoint', 'heat_index'];
    case 'fog':
    case 'visibility':
      return ['visibility', 'humidity', 'dewpoint'];
    case 'snow':
      return ['snowfall', 'temperature', 'precipitation_probability'];
    case 'plan_impact':
      return ['precipitation_probability', 'precipitation', 'temperature',
              'windspeed', 'wind_gusts', 'cape', 'lightning'];
    case 'nowcast':
      return ['precipitation', 'temperature', 'windspeed', 'radar'];
    default:
      return ['precipitation_probability', 'temperature', 'windspeed'];
  }
}