export type ActivityType =
  | 'concrete'
  | 'outdoor_event'
  | 'wedding'
  | 'sports'
  | 'motorcycle'
  | 'cycling'
  | 'fishing'
  | 'construction'
  | 'fog_visibility'
  | 'lightning_risk'
  | 'storm_general'
  | 'hurricane'
  | 'general';

export interface ParsedQuestion {
  activityType: ActivityType;
  timeWindow: string;
  hoursAhead: number;
  needsHRRR: boolean;
  needsSounding: boolean;
  needsRadar: boolean;
  needsLightning: boolean;
  needsGulf: boolean;
  needsEnsemble: boolean;
  sensitivityProfile: string;
}

export function parseQuestion(question: string): ParsedQuestion {
  const q = question.toLowerCase();

  const activityType: ActivityType =
    /concrete|pour|pouring|slab|foundation/.test(q) ? 'concrete' :
    /wedding|ceremony|reception|bride|groom/.test(q) ? 'wedding' :
    /soccer|football|baseball|softball|game|match|tournament|sport/.test(q) ? 'sports' :
    /motorcycle|moto|ride|biker/.test(q) ? 'motorcycle' :
    /bike|cycling|bicycle|biking/.test(q) ? 'cycling' :
    /fish|fishing|boat|boating|offshore|bay/.test(q) ? 'fishing' :
    /construction|roofing|painting|scaffold|crane/.test(q) ? 'construction' :
    /fog|foggy|visibility|mist|haze/.test(q) ? 'fog_visibility' :
    /lightning|thunder/.test(q) ? 'lightning_risk' :
    /hurricane|tropical|storm surge|cyclone/.test(q) ? 'hurricane' :
    /storm|severe|tornado|hail|squall/.test(q) ? 'storm_general' :
    /outdoor|outside|open air|festival|concert|party|bbq|pool|event/.test(q) ? 'outdoor_event' :
    'general';

  const hoursAhead =
    /right now|currently|this moment/.test(q) ? 0 :
    /tonight|this evening/.test(q) ? 6 :
    /tomorrow morning|tomorrow at [0-9]/.test(q) ? 18 :
    /tomorrow/.test(q) ? 24 :
    /this weekend|saturday|sunday/.test(q) ? 48 :
    /next week/.test(q) ? 96 :
    24;

  const timeWindow =
    hoursAhead === 0 ? 'current conditions' :
    hoursAhead <= 12 ? 'next 12 hours' :
    hoursAhead <= 24 ? 'next 24 hours' :
    hoursAhead <= 48 ? 'next 48 hours' :
    'extended outlook';

  const sensitivityProfiles: Record<ActivityType, string> = {
    concrete: 'EXTREME rain sensitivity. Any rain during or 4 hours after pour ruins the slab. Wind over 20mph also problematic. Temperature below 40°F or above 95°F affects cure. A 20% PoP is a NO-GO for concrete.',
    wedding: 'HIGH rain sensitivity but decisions must be made 24-48 hours in advance for venue changes. Even 30% risk warrants a backup plan discussion. Wind, lightning, and extreme heat also matter.',
    sports: 'MODERATE rain tolerance. Lightning is absolute NO-GO (1 strike within 10 miles = stop play). Heavy rain stops most sports. Light rain acceptable for many. Field flooding matters.',
    motorcycle: 'HIGH rain and wind sensitivity. Any rain on roads creates hazard. Wind over 30mph dangerous. Fog reduces visibility critically. 30% rain chance warrants caution.',
    cycling: 'HIGH fog and rain sensitivity. Wet roads dangerous. Morning fog often burns off — timing matters. Wind direction and speed affects effort and safety.',
    fishing: 'MODERATE weather sensitivity. Lightning is NO-GO. Offshore fishing highly wind and wave sensitive (Gulf wave height critical). Bay fishing more tolerant.',
    construction: 'VARIES by task. Roofing: no rain. Painting: no humidity above 85%, no rain. Crane ops: wind over 25mph = stop. Foundation work: heavy rain causes washout.',
    outdoor_event: 'MODERATE sensitivity. Lightning NO-GO. Heavy rain ruins events. Light rain tolerable with tents. Extreme heat (>100°F heat index) also a risk.',
    fog_visibility: 'Fog forms when dewpoint-temperature spread drops below 3°F. Marine layer, radiation fog, advection fog have different burn-off times. Mixing height determines clearing time.',
    lightning_risk: 'STRICT threshold. Any lightning within 10 miles = seek shelter. 30-30 rule: 30 seconds flash-to-thunder = under 6 miles. Wait 30 minutes after last strike.',
    storm_general: 'Evaluate wind, hail, tornado, and flash flood threats separately. SPC outlook level is primary guidance. Timing and motion vector critical.',
    hurricane: 'Multi-day planning window. Storm surge is primary killer. Wind zones: TS force (39mph+), hurricane force (74mph+). Evacuation decisions 48-72 hours out.',
    general: 'Standard rain and wind sensitivity. Evaluate PoP, wind speed, and any severe weather potential.',
  };

  return {
    activityType,
    timeWindow,
    hoursAhead,
    needsHRRR: hoursAhead <= 48,
    needsSounding: ['concrete', 'storm_general', 'lightning_risk', 'outdoor_event', 'wedding'].includes(activityType),
    needsRadar: hoursAhead <= 12 || ['storm_general', 'lightning_risk', 'concrete'].includes(activityType),
    needsLightning: ['sports', 'outdoor_event', 'wedding', 'lightning_risk', 'fishing'].includes(activityType),
    needsGulf: ['fishing', 'hurricane', 'fog_visibility'].includes(activityType),
    needsEnsemble: hoursAhead >= 48,
    sensitivityProfile: sensitivityProfiles[activityType],
  };
}