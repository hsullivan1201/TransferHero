/**
 * Manual mapping: GTFS exit names → platform exitLabel groups.
 *
 * For each multi-exit station, an ordered list of rules.
 * The GTFS exit name is matched case-insensitively against each rule's
 * `match` keywords (substring match). First matching rule wins.
 *
 * Only the 23 stations with multiple exitLabel groups need entries here.
 * Single-exit stations fall through to the keyword-matching fallback.
 */

interface ExitRule {
  match: string[]
  exitLabel: number
}

const EXIT_MAP: Record<string, ExitRule[]> = {
  // ─── Anacostia (F06) ───
  // exitLabel 1: Parking Garage (north end)
  // exitLabel 2: Howard Rd (south end, Firth Sterling area)
  'F06': [
    { match: ['firth', 'sterling', 'busbay'], exitLabel: 2 },
    { match: ['freeway', 'north of'], exitLabel: 1 },
  ],

  // ─── Dupont Circle (A03) ───
  // exitLabel 1: Q St (south end — Connecticut & Q intersection)
  // exitLabel 2: Connecticut Ave (north end — 19th St / Dupont Circle)
  'A03': [
    { match: ['19th'], exitLabel: 2 },
    { match: ['q st', 'q street'], exitLabel: 1 },
  ],

  // ─── Farragut North (A02) ───
  // exitLabel 1: North Side L St (NE corner)
  // exitLabel 2: South Side L St (SW corner)
  // exitLabel 3: K St
  'A02': [
    { match: ['k st', 'k street'], exitLabel: 3 },
    { match: ['sw corner'], exitLabel: 2 },
    { match: ['l st', 'l street', 'ne corner'], exitLabel: 1 },
  ],

  // ─── Farragut West (C03) ───
  // exitLabel 1: 18th & I
  // exitLabel 2: 17th & I
  'C03': [
    { match: ['17th'], exitLabel: 2 },
    { match: ['18th'], exitLabel: 1 },
  ],

  // ─── Friendship Heights (A08) ───
  // exitLabel 1: Western Ave (north end)
  // exitLabel 2: Jenifer St (south end)
  'A08': [
    { match: ['jenifer'], exitLabel: 2 },
    { match: ['western', 'wisconsin'], exitLabel: 1 },
  ],

  // ─── Gallery Place (B01 / F01) ───
  // exitLabel 1: 9th & G St (west)
  // exitLabel 3: 7th & H St (north)
  // exitLabel 4: Elevator
  // exitLabel 5: 7th & F St (south/east)
  'B01': [
    { match: ['9th', '9 st', '9st'], exitLabel: 1 },
    { match: ['h st', 'h street'], exitLabel: 3 },
    { match: ['elevator'], exitLabel: 4 },
    { match: ['f st', 'f street'], exitLabel: 5 },
  ],
  'F01': [
    { match: ['9th', '9 st', '9st'], exitLabel: 1 },
    { match: ['h st', 'h street'], exitLabel: 3 },
    { match: ['elevator'], exitLabel: 4 },
    { match: ['f st', 'f street'], exitLabel: 5 },
  ],

  // ─── Huntington (C15) ───
  // exitLabel 1: Huntington Ave / Fenwick Dr
  // exitLabel 2: Kings Highway
  'C15': [
    { match: ['kings', 'highway', 'fort'], exitLabel: 2 },
    { match: ['fenwick', 'huntington'], exitLabel: 1 },
  ],

  // ─── Judiciary Square (B02) ───
  // exitLabel 1: F St (between 4th & 5th)
  // exitLabel 2: 4th St (between D & E)
  'B02': [
    { match: ['f st', 'f street', '5th'], exitLabel: 1 },
    { match: ['d st', 'e st', 'd &'], exitLabel: 2 },
  ],

  // ─── King Street-Old Town (C13) ───
  // exitLabel 1: Commonwealth Ave (main entrance)
  // exitLabel 2: King St / Cameron St
  // exitLabel 3: Bus Bay / Commuter Train
  'C13': [
    { match: ['commuter', 'train connection'], exitLabel: 3 },
    { match: ['cameron'], exitLabel: 2 },
    { match: ['commonwealth', 'king st'], exitLabel: 1 },
  ],

  // ─── McPherson Square (C02) ───
  // exitLabel 1: Vermont Ave
  // exitLabel 2: 14th & I
  'C02': [
    { match: ['vermont'], exitLabel: 1 },
    { match: ['14th'], exitLabel: 2 },
  ],

  // ─── Metro Center (A01 / C01) ───
  // exitLabel 1: 13th & G (Entrance D)
  // exitLabel 2: 11th & G (Entrance B)
  // exitLabel 3: Elevator (12th & G)
  // exitLabel 5: 12th & G (Entrance A)
  // exitLabel 6: 12th & F (Entrance C)
  'A01': [
    { match: ['13th'], exitLabel: 1 },
    { match: ['11th'], exitLabel: 2 },
    { match: ['elevator'], exitLabel: 3 },
    { match: ['f st', 'f street'], exitLabel: 6 },
    { match: ['12th', 'g st', 'g street'], exitLabel: 5 },
  ],
  'C01': [
    { match: ['13th'], exitLabel: 1 },
    { match: ['11th'], exitLabel: 2 },
    { match: ['elevator'], exitLabel: 3 },
    { match: ['f st', 'f street'], exitLabel: 6 },
    { match: ['12th', 'g st', 'g street'], exitLabel: 5 },
  ],

  // ─── Navy Yard-Ballpark (F05) ───
  // exitLabel 1: Ballpark / Half St (west)
  // exitLabel 2: New Jersey Ave (east)
  'F05': [
    { match: ['half'], exitLabel: 1 },
    { match: ['new jersey'], exitLabel: 2 },
  ],

  // ─── NoMa-Gallaudet U (B35) ───
  // exitLabel 1: M St (south)
  // exitLabel 2: Florida Ave (north)
  'B35': [
    { match: ['florida'], exitLabel: 2 },
    { match: ['m st', 'm &', 'm street'], exitLabel: 1 },
  ],

  // ─── Pentagon (C07) ───
  // exitLabel 1: Elevator to Platform Only
  // exitLabel 2: Pentagon Transit Center
  'C07': [
    { match: ['elevator'], exitLabel: 1 },
    { match: ['rotary', 'pentagon', 'eads'], exitLabel: 2 },
  ],

  // ─── Shaw-Howard U (E02) ───
  // exitLabel 1: Howard University (7th & S Sts)
  // exitLabel 2: 8th & R St
  'E02': [
    { match: ['r st', 'r street', '8th'], exitLabel: 2 },
    { match: ['s st', 's street', '7th & s'], exitLabel: 1 },
  ],

  // ─── Silver Spring (B08) ───
  // exitLabel 1: S Colesville Rd (southeast, Wayne Ave side)
  // exitLabel 2: N Colesville Rd (northwest, E-W Hwy side)
  'B08': [
    { match: ['south side', 'wayne'], exitLabel: 1 },
    { match: ['north side', 'e-west', 'east-west'], exitLabel: 2 },
  ],

  // ─── Smithsonian (D02) ───
  // exitLabel 1: 12th & Jefferson (The Mall side)
  // exitLabel 2: 12th & Independence (south side)
  'D02': [
    { match: ['jefferson', 'mall'], exitLabel: 1 },
    { match: ['independence'], exitLabel: 2 },
  ],

  // ─── Stadium-Armory (D08) ───
  // exitLabel 1: C St (south end)
  // exitLabel 2: Armory / Independence Ave (north end)
  'D08': [
    { match: ['independence', 'armory'], exitLabel: 2 },
    { match: ['burke', 'c st', 'c street'], exitLabel: 1 },
  ],

  // ─── U Street (E03) ───
  // exitLabel 1: 13th & U St (west)
  // exitLabel 2: 10th & U St (east)
  'E03': [
    { match: ['13th'], exitLabel: 1 },
    { match: ['10th'], exitLabel: 2 },
  ],

  // ─── Union Station (B03) ───
  // exitLabel 1: Massachusetts Ave (south)
  // exitLabel 2: 1st St / Amtrak (north)
  'B03': [
    { match: ['amtrak', 'g st'], exitLabel: 2 },
    { match: ['massachusetts'], exitLabel: 1 },
  ],

  // ─── Washington National Airport (C10) ───
  // exitLabel 1: C/D/E Gates (north, main terminal / Smith Blvd)
  // exitLabel 2: A/B/C Gates (south, Terminals B & C)
  'C10': [
    { match: ['terminal b', 'terminals b'], exitLabel: 2 },
    { match: ['main terminal', 'smith'], exitLabel: 1 },
  ],

  // ─── Wheaton (B10) ───
  // exitLabel 1: Georgia Ave (main entrance at Reedie Dr)
  // exitLabel 2: Georgia Ave (busbay tunnel entrance)
  'B10': [
    { match: ['busbay', 'tunnel'], exitLabel: 2 },
    { match: ['reedie', 'georgia'], exitLabel: 1 },
  ],
}

/**
 * Resolve a GTFS exit name to the platform exitLabel for a given station.
 * Returns undefined if no mapping exists or no rule matches.
 */
export function resolveExitLabel(stationCode: string, gtfsExitName: string): number | undefined {
  const rules = EXIT_MAP[stationCode]
  if (!rules) return undefined

  const lowerName = gtfsExitName.toLowerCase()
  for (const rule of rules) {
    if (rule.match.some(keyword => lowerName.includes(keyword))) {
      return rule.exitLabel
    }
  }
  return undefined
}
