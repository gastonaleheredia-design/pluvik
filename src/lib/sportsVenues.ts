/**
 * Map of US sports team nicknames and city references to their home venue.
 * When a question mentions a team name, we resolve to the venue address
 * so the forecast is for the actual game location, not just the city.
 * Covers MLB, NFL, NBA, NHL, MLS major markets.
 */
const SPORTS_TEAM_VENUES: Record<string, string> = {
  // MLB
  'astros': 'Minute Maid Park, Houston, TX',
  'yankees': 'Yankee Stadium, Bronx, NY',
  'mets': 'Citi Field, Queens, NY',
  'red sox': 'Fenway Park, Boston, MA',
  'cubs': 'Wrigley Field, Chicago, IL',
  'white sox': 'Guaranteed Rate Field, Chicago, IL',
  'dodgers': 'Dodger Stadium, Los Angeles, CA',
  'giants': 'Oracle Park, San Francisco, CA',
  'cardinals': 'Busch Stadium, St. Louis, MO',
  'braves': 'Truist Park, Atlanta, GA',
  'phillies': 'Citizens Bank Park, Philadelphia, PA',
  'rangers': 'Globe Life Field, Arlington, TX',
  'mariners': 'T-Mobile Park, Seattle, WA',
  'rockies': 'Coors Field, Denver, CO',
  'padres': 'Petco Park, San Diego, CA',
  'angels': 'Angel Stadium, Anaheim, CA',
  'athletics': 'Oakland Coliseum, Oakland, CA',
  'tigers': 'Comerica Park, Detroit, MI',
  'twins': 'Target Field, Minneapolis, MN',
  'indians': 'Progressive Field, Cleveland, OH',
  'guardians': 'Progressive Field, Cleveland, OH',
  'reds': 'Great American Ball Park, Cincinnati, OH',
  'pirates': 'PNC Park, Pittsburgh, PA',
  'brewers': 'American Family Field, Milwaukee, WI',
  'royals': 'Kauffman Stadium, Kansas City, MO',
  'orioles': 'Camden Yards, Baltimore, MD',
  'nationals': 'Nationals Park, Washington, DC',
  'marlins': 'LoanDepot Park, Miami, FL',
  'rays': 'Tropicana Field, St. Petersburg, FL',
  'blue jays': 'Rogers Centre, Toronto, ON',
  // NFL
  'texans': 'NRG Stadium, Houston, TX',
  'cowboys': 'AT&T Stadium, Arlington, TX',
  'patriots': 'Gillette Stadium, Foxborough, MA',
  'packers': 'Lambeau Field, Green Bay, WI',
  'bears': 'Soldier Field, Chicago, IL',
  'chiefs': 'Arrowhead Stadium, Kansas City, MO',
  'raiders': 'Allegiant Stadium, Las Vegas, NV',
  'seahawks': 'Lumen Field, Seattle, WA',
  'rams': 'SoFi Stadium, Inglewood, CA',
  'chargers': 'SoFi Stadium, Inglewood, CA',
  '49ers': "Levi's Stadium, Santa Clara, CA",
  'broncos': 'Empower Field, Denver, CO',
  'eagles': 'Lincoln Financial Field, Philadelphia, PA',
  'giants nfl': 'MetLife Stadium, East Rutherford, NJ',
  'jets': 'MetLife Stadium, East Rutherford, NJ',
  'saints': 'Caesars Superdome, New Orleans, LA',
  'falcons': 'Mercedes-Benz Stadium, Atlanta, GA',
  'panthers': 'Bank of America Stadium, Charlotte, NC',
  'buccaneers': 'Raymond James Stadium, Tampa, FL',
  'dolphins': 'Hard Rock Stadium, Miami Gardens, FL',
  // NBA
  'rockets': 'Toyota Center, Houston, TX',
  'lakers': 'Crypto.com Arena, Los Angeles, CA',
  'celtics': 'TD Garden, Boston, MA',
  'bulls': 'United Center, Chicago, IL',
  'knicks': 'Madison Square Garden, New York, NY',
  'warriors': 'Chase Center, San Francisco, CA',
  'heat': 'Kaseya Center, Miami, FL',
  'spurs': 'Frost Bank Center, San Antonio, TX',
  'mavs': 'American Airlines Center, Dallas, TX',
  'mavericks': 'American Airlines Center, Dallas, TX',
  // MLS
  'dynamo': 'Shell Energy Stadium, Houston, TX',
  // Generic venue keywords
  'minute maid': 'Minute Maid Park, Houston, TX',
  'yankee stadium': 'Yankee Stadium, Bronx, NY',
  'fenway': 'Fenway Park, Boston, MA',
  'wrigley': 'Wrigley Field, Chicago, IL',
  'lambeau': 'Lambeau Field, Green Bay, WI',
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