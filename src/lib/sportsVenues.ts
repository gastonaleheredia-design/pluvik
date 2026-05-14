/**
 * Map of US sports team nicknames and city references to their home venue.
 * When a question mentions a team name, we resolve to the venue address
 * so the forecast is for the actual game location, not just the city.
 * Covers MLB, NFL, NBA, NHL, MLS major markets.
 */
const SPORTS_TEAM_VENUES: Record<string, string> = {
  // MLB — search queries, not hardcoded venue names
  'astros': 'Houston Astros ballpark Houston TX',
  'yankees': 'Yankees stadium Bronx NY',
  'mets': 'Mets stadium Queens NY',
  'red sox': 'Red Sox Fenway Park Boston MA',
  'cubs': 'Cubs Wrigley Field Chicago IL',
  'white sox': 'White Sox stadium Chicago IL',
  'dodgers': 'Dodgers stadium Los Angeles CA',
  'giants baseball': 'Giants baseball stadium San Francisco CA',
  'cardinals baseball': 'Cardinals baseball stadium St Louis MO',
  'braves': 'Braves stadium Atlanta GA',
  'phillies': 'Phillies stadium Philadelphia PA',
  'rangers baseball': 'Rangers baseball stadium Arlington TX',
  'mariners': 'Mariners stadium Seattle WA',
  'rockies': 'Rockies stadium Denver CO',
  'padres': 'Padres stadium San Diego CA',
  'angels': 'Angels stadium Anaheim CA',
  'tigers': 'Tigers stadium Detroit MI',
  'twins': 'Twins stadium Minneapolis MN',
  'guardians': 'Guardians stadium Cleveland OH',
  'reds': 'Reds stadium Cincinnati OH',
  'pirates': 'Pirates stadium Pittsburgh PA',
  'brewers': 'Brewers stadium Milwaukee WI',
  'royals': 'Royals stadium Kansas City MO',
  'orioles': 'Orioles stadium Baltimore MD',
  'nationals': 'Nationals stadium Washington DC',
  'marlins': 'Marlins stadium Miami FL',
  'rays': 'Rays stadium St Petersburg FL',
  // NFL
  'texans': 'Texans NFL stadium Houston TX',
  'cowboys': 'Cowboys AT&T Stadium Arlington TX',
  'patriots': 'Patriots stadium Foxborough MA',
  'packers': 'Lambeau Field Green Bay WI',
  'bears': 'Bears stadium Chicago IL',
  'chiefs': 'Chiefs stadium Kansas City MO',
  'raiders': 'Raiders stadium Las Vegas NV',
  'seahawks': 'Seahawks stadium Seattle WA',
  'rams': 'Rams stadium Inglewood CA',
  'chargers': 'Chargers stadium Inglewood CA',
  '49ers': 'Niners stadium Santa Clara CA',
  'broncos': 'Broncos stadium Denver CO',
  'eagles': 'Eagles stadium Philadelphia PA',
  'saints': 'Saints stadium New Orleans LA',
  'falcons': 'Falcons stadium Atlanta GA',
  'panthers': 'Panthers stadium Charlotte NC',
  'buccaneers': 'Buccaneers stadium Tampa FL',
  'dolphins': 'Dolphins stadium Miami FL',
  // NBA
  'rockets': 'Rockets NBA arena Houston TX',
  'lakers': 'Lakers arena Los Angeles CA',
  'celtics': 'Celtics arena Boston MA',
  'bulls': 'Bulls arena Chicago IL',
  'knicks': 'Madison Square Garden New York NY',
  'warriors': 'Warriors arena San Francisco CA',
  'heat': 'Heat arena Miami FL',
  'spurs': 'Spurs arena San Antonio TX',
  'mavericks': 'Mavericks arena Dallas TX',
  'mavs': 'Mavericks arena Dallas TX',
  // MLS
  'dynamo': 'Houston Dynamo stadium Houston TX',
};

/**
 * Detect a sports team or venue reference in a question and return
 * the home venue address for geocoding. Returns null when none match.
 */
export function extractSportsVenue(question: string): string | null {
  const q = question.toLowerCase();
  for (const [team, venue] of Object.entries(SPORTS_TEAM_VENUES)) {
    if (q.includes(team)) return venue;
  }
  return null;
}