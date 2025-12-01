const DESTINATION_ALIASES: Record<string, string> = {
  'Largo': 'Largo Town Center',
  'NewCrltn': 'New Carrollton',
  'Glenmont': 'Glenmont',
  'Shady Gr': 'Shady Grove',
  'Greenbelt': 'Greenbelt',
  'Huntingtn': 'Huntington',
  'Frncnia': 'Franconia',
  'Vienna': 'Vienna',
  'Wiehle': 'Wiehle-Reston East',
  'Ashburn': 'Ashburn',
  'Branch Av': 'Branch Avenue',
  'Mt Vernon': 'Mt Vernon Sq',
  'Gallery': 'Gallery Pl-Chinatown',
  'Pentagon': 'Pentagon',
  'Reagan': 'Reagan National',
  'Farragut': 'Farragut North',
  'Judiciary': 'Judiciary Square'
}

const DISPLAY_NAMES: Record<string, string> = {
  'Gallery Pl-Chinatown': 'Gallery Place',
  'Mt Vernon Sq 7th St-Convention Center': 'Mt Vernon Sq',
  'U Street/African-Amer Civil War Memorial/Cardozo': 'U Street',
  'Archives-Navy Memorial-Penn Quarter': 'Archives',
  'Federal Triangle': 'Federal Triangle',
  'Smithsonian': 'Smithsonian',
  'Largo Town Center': 'Largo',
  'New Carrollton': 'New Carrollton',
  'NoMa-Gallaudet U': 'NoMa',
  'Wiehle-Reston East': 'Wiehle'
}

export function normalizeDestination(dest: string): string {
  return DESTINATION_ALIASES[dest] || dest
}

export function getDisplayName(dest: string): string {
  const normalized = normalizeDestination(dest)
  return DISPLAY_NAMES[normalized] || normalized
}
