/**
 * Compact list of US NEXRAD WSR-88D ("K") and TDWR ("T") radar sites.
 * Used by the radar sheet to let the user pick a single radar instead of
 * the MRMS national mosaic. Coordinates are approximate (radar dome).
 *
 * Not exhaustive — covers major CONUS metros + Texas/Gulf coverage where
 * the current user base lives. Add more as needed.
 */
export interface NexradSite {
  id: string;       // e.g. "KHGX", "THOU"
  name: string;     // human label
  lat: number;
  lon: number;
  kind: 'WSR-88D' | 'TDWR';
}

export const NEXRAD_SITES: NexradSite[] = [
  // Texas + Gulf
  { id: 'KHGX', name: 'Houston / Galveston, TX', lat: 29.4719, lon: -95.0792, kind: 'WSR-88D' },
  { id: 'THOU', name: 'Houston Hobby (TDWR)', lat: 29.5161, lon: -95.2414, kind: 'TDWR' },
  { id: 'TIAH', name: 'Houston Bush (TDWR)', lat: 30.0647, lon: -95.5672, kind: 'TDWR' },
  { id: 'KGRK', name: 'Central Texas (Fort Hood)', lat: 30.7219, lon: -97.3831, kind: 'WSR-88D' },
  { id: 'KEWX', name: 'Austin / San Antonio', lat: 29.7039, lon: -98.0286, kind: 'WSR-88D' },
  { id: 'KCRP', name: 'Corpus Christi, TX', lat: 27.7842, lon: -97.5111, kind: 'WSR-88D' },
  { id: 'KBRO', name: 'Brownsville, TX', lat: 25.9161, lon: -97.4189, kind: 'WSR-88D' },
  { id: 'KFWS', name: 'Dallas / Fort Worth', lat: 32.5731, lon: -97.3031, kind: 'WSR-88D' },
  { id: 'TDFW', name: 'DFW Airport (TDWR)', lat: 33.0644, lon: -96.9178, kind: 'TDWR' },
  { id: 'KDYX', name: 'Dyess AFB / Abilene', lat: 32.5383, lon: -99.2542, kind: 'WSR-88D' },
  { id: 'KSJT', name: 'San Angelo, TX', lat: 31.3711, lon: -100.4925, kind: 'WSR-88D' },
  { id: 'KAMA', name: 'Amarillo, TX', lat: 35.2333, lon: -101.7092, kind: 'WSR-88D' },
  { id: 'KLBB', name: 'Lubbock, TX', lat: 33.6542, lon: -101.8142, kind: 'WSR-88D' },
  { id: 'KMAF', name: 'Midland / Odessa', lat: 31.9433, lon: -102.1894, kind: 'WSR-88D' },
  { id: 'KEPZ', name: 'El Paso, TX', lat: 31.8731, lon: -106.6975, kind: 'WSR-88D' },
  { id: 'KLCH', name: 'Lake Charles, LA', lat: 30.1253, lon: -93.2161, kind: 'WSR-88D' },
  { id: 'KLIX', name: 'New Orleans, LA', lat: 30.3367, lon: -89.8256, kind: 'WSR-88D' },
  { id: 'KSHV', name: 'Shreveport, LA', lat: 32.4508, lon: -93.8414, kind: 'WSR-88D' },
  { id: 'KLZK', name: 'Little Rock, AR', lat: 34.8364, lon: -92.2622, kind: 'WSR-88D' },
  { id: 'KMOB', name: 'Mobile, AL', lat: 30.6794, lon: -88.2397, kind: 'WSR-88D' },
  { id: 'KEVX', name: 'Eglin AFB, FL', lat: 30.5644, lon: -85.9214, kind: 'WSR-88D' },
  { id: 'KTLH', name: 'Tallahassee, FL', lat: 30.3975, lon: -84.3289, kind: 'WSR-88D' },
  { id: 'KJAX', name: 'Jacksonville, FL', lat: 30.4847, lon: -81.7019, kind: 'WSR-88D' },
  { id: 'KMLB', name: 'Melbourne, FL', lat: 28.1133, lon: -80.6542, kind: 'WSR-88D' },
  { id: 'KAMX', name: 'Miami, FL', lat: 25.6111, lon: -80.4128, kind: 'WSR-88D' },
  { id: 'KBYX', name: 'Key West, FL', lat: 24.5975, lon: -81.7031, kind: 'WSR-88D' },
  { id: 'KTBW', name: 'Tampa Bay, FL', lat: 27.7053, lon: -82.4017, kind: 'WSR-88D' },
  // Southeast
  { id: 'KFFC', name: 'Atlanta, GA', lat: 33.3636, lon: -84.5658, kind: 'WSR-88D' },
  { id: 'KGSP', name: 'Greer / Upstate SC', lat: 34.8833, lon: -82.2200, kind: 'WSR-88D' },
  { id: 'KCAE', name: 'Columbia, SC', lat: 33.9486, lon: -81.1186, kind: 'WSR-88D' },
  { id: 'KCLX', name: 'Charleston, SC', lat: 32.6555, lon: -81.0420, kind: 'WSR-88D' },
  { id: 'KLTX', name: 'Wilmington, NC', lat: 33.9892, lon: -78.4292, kind: 'WSR-88D' },
  { id: 'KMHX', name: 'Morehead City, NC', lat: 34.7758, lon: -76.8761, kind: 'WSR-88D' },
  { id: 'KRAX', name: 'Raleigh / Durham', lat: 35.6656, lon: -78.4900, kind: 'WSR-88D' },
  { id: 'KOHX', name: 'Nashville, TN', lat: 36.2472, lon: -86.5625, kind: 'WSR-88D' },
  { id: 'KMRX', name: 'Knoxville, TN', lat: 36.1686, lon: -83.4019, kind: 'WSR-88D' },
  // Midwest
  { id: 'KLOT', name: 'Chicago, IL', lat: 41.6044, lon: -88.0847, kind: 'WSR-88D' },
  { id: 'KILX', name: 'Central Illinois', lat: 40.1506, lon: -89.3367, kind: 'WSR-88D' },
  { id: 'KIND', name: 'Indianapolis, IN', lat: 39.7075, lon: -86.2803, kind: 'WSR-88D' },
  { id: 'KIWX', name: 'Northern Indiana', lat: 41.3589, lon: -85.7000, kind: 'WSR-88D' },
  { id: 'KDTX', name: 'Detroit, MI', lat: 42.6997, lon: -83.4717, kind: 'WSR-88D' },
  { id: 'KGRR', name: 'Grand Rapids, MI', lat: 42.8939, lon: -85.5450, kind: 'WSR-88D' },
  { id: 'KMKX', name: 'Milwaukee, WI', lat: 42.9678, lon: -88.5506, kind: 'WSR-88D' },
  { id: 'KMPX', name: 'Minneapolis, MN', lat: 44.8489, lon: -93.5656, kind: 'WSR-88D' },
  { id: 'KDMX', name: 'Des Moines, IA', lat: 41.7311, lon: -93.7228, kind: 'WSR-88D' },
  { id: 'KEAX', name: 'Kansas City, MO', lat: 38.8103, lon: -94.2644, kind: 'WSR-88D' },
  { id: 'KSGF', name: 'Springfield, MO', lat: 37.2353, lon: -93.4006, kind: 'WSR-88D' },
  { id: 'KLSX', name: 'St. Louis, MO', lat: 38.6989, lon: -90.6828, kind: 'WSR-88D' },
  { id: 'KTWX', name: 'Topeka, KS', lat: 38.9969, lon: -96.2325, kind: 'WSR-88D' },
  { id: 'KICT', name: 'Wichita, KS', lat: 37.6544, lon: -97.4431, kind: 'WSR-88D' },
  { id: 'KOAX', name: 'Omaha, NE', lat: 41.3203, lon: -96.3669, kind: 'WSR-88D' },
  { id: 'KOUN', name: 'Norman, OK', lat: 35.2361, lon: -97.4622, kind: 'WSR-88D' },
  { id: 'KTLX', name: 'Oklahoma City, OK', lat: 35.3331, lon: -97.2778, kind: 'WSR-88D' },
  { id: 'KINX', name: 'Tulsa, OK', lat: 36.1750, lon: -95.5644, kind: 'WSR-88D' },
  // Northeast / Mid-Atlantic
  { id: 'KOKX', name: 'New York City', lat: 40.8656, lon: -72.8639, kind: 'WSR-88D' },
  { id: 'KDIX', name: 'Philadelphia / Mt Holly', lat: 39.9469, lon: -74.4108, kind: 'WSR-88D' },
  { id: 'KLWX', name: 'Sterling / DC', lat: 38.9758, lon: -77.4778, kind: 'WSR-88D' },
  { id: 'KAKQ', name: 'Wakefield, VA', lat: 36.9839, lon: -77.0072, kind: 'WSR-88D' },
  { id: 'KBOX', name: 'Boston, MA', lat: 41.9558, lon: -71.1369, kind: 'WSR-88D' },
  { id: 'KBGM', name: 'Binghamton, NY', lat: 42.1997, lon: -75.9847, kind: 'WSR-88D' },
  { id: 'KBUF', name: 'Buffalo, NY', lat: 42.9489, lon: -78.7367, kind: 'WSR-88D' },
  { id: 'KPBZ', name: 'Pittsburgh, PA', lat: 40.5317, lon: -80.2181, kind: 'WSR-88D' },
  { id: 'KCLE', name: 'Cleveland, OH', lat: 41.4131, lon: -81.8597, kind: 'WSR-88D' },
  { id: 'KILN', name: 'Cincinnati, OH', lat: 39.4203, lon: -83.8217, kind: 'WSR-88D' },
  // Mountain / West
  { id: 'KFTG', name: 'Denver, CO', lat: 39.7867, lon: -104.5458, kind: 'WSR-88D' },
  { id: 'KPUX', name: 'Pueblo, CO', lat: 38.4594, lon: -104.1814, kind: 'WSR-88D' },
  { id: 'KABX', name: 'Albuquerque, NM', lat: 35.1497, lon: -106.8239, kind: 'WSR-88D' },
  { id: 'KFSX', name: 'Flagstaff, AZ', lat: 34.5744, lon: -111.1981, kind: 'WSR-88D' },
  { id: 'KIWA', name: 'Phoenix, AZ', lat: 33.2892, lon: -111.6700, kind: 'WSR-88D' },
  { id: 'KEMX', name: 'Tucson, AZ', lat: 31.8936, lon: -110.6303, kind: 'WSR-88D' },
  { id: 'KESX', name: 'Las Vegas, NV', lat: 35.7014, lon: -114.8914, kind: 'WSR-88D' },
  { id: 'KMUX', name: 'San Francisco Bay', lat: 37.1550, lon: -121.8983, kind: 'WSR-88D' },
  { id: 'KDAX', name: 'Sacramento, CA', lat: 38.5011, lon: -121.6778, kind: 'WSR-88D' },
  { id: 'KVTX', name: 'Los Angeles, CA', lat: 34.4117, lon: -119.1794, kind: 'WSR-88D' },
  { id: 'KSOX', name: 'Santa Ana / OC', lat: 33.8178, lon: -117.6358, kind: 'WSR-88D' },
  { id: 'KNKX', name: 'San Diego, CA', lat: 32.9189, lon: -117.0419, kind: 'WSR-88D' },
  { id: 'KMTX', name: 'Salt Lake City, UT', lat: 41.2628, lon: -112.4478, kind: 'WSR-88D' },
  { id: 'KMSX', name: 'Missoula, MT', lat: 47.0411, lon: -113.9861, kind: 'WSR-88D' },
  { id: 'KPDT', name: 'Pendleton, OR', lat: 45.6906, lon: -118.8528, kind: 'WSR-88D' },
  { id: 'KRTX', name: 'Portland, OR', lat: 45.7150, lon: -122.9650, kind: 'WSR-88D' },
  { id: 'KATX', name: 'Seattle, WA', lat: 48.1947, lon: -122.4956, kind: 'WSR-88D' },
];

/** Distance in miles between two lat/lon pairs. */
function distMi(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(la2 - la1);
  const dLon = toRad(lo2 - lo1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Returns the N closest sites to a point, with distance attached. */
export function nearestSites(
  lat: number,
  lon: number,
  n = 6,
): Array<NexradSite & { distMi: number }> {
  return NEXRAD_SITES
    .map((s) => ({ ...s, distMi: distMi(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.distMi - b.distMi)
    .slice(0, n);
}