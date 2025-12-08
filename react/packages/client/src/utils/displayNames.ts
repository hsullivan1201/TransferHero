// welcome to displayNames.ts (react/packages/client/src/utils)

const DESTINATION_ALIASES: Record<string, string> = {
  'Largo': 'Largo Town Center',
  'NewCrltn': 'New Carrollton',
  'Glenmont': 'Glenmont',
  'Shady Gr': 'Shady Grove',
  'Shady Grv': 'Shady Grove', // added this because wmata realtime loves being quirky
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

function toTitleCase(str: string): string {
  return str.toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase()) // title-case the words so they stop yelling
    .replace(/'S\b/g, "'s") // fix possessives like george's
}

export function normalizeDestination(dest: string): string {
  // step 1: try a straight-up alias match (e.g. "Shady Grv", "NewCrltn")
  if (DESTINATION_ALIASES[dest]) {
    return DESTINATION_ALIASES[dest]
  }

  // step 2: if it's screaming in all caps, chill it out
  if (dest && dest === dest.toUpperCase()) {
    const titleCased = toTitleCase(dest)
    // give aliases another shot after title casing
    // e.g. "SHADY GR" -> "Shady Gr" -> "Shady Grove"
    return DESTINATION_ALIASES[titleCased] || titleCased
  }

  return dest
}

export function getDisplayName(dest: string): string {
  const normalized = normalizeDestination(dest)
  return DISPLAY_NAMES[normalized] || normalized
}