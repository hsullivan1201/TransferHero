/**
 * Converts train Min value to integer minutes
 * @param min - Train Min value ('ARR', 'BRD', or number)
 * @returns Minutes as integer (0 for ARR/BRD)
 */
export function getTrainMinutes(min: string | number): number {
  return min === 'ARR' || min === 'BRD' ? 0 : parseInt(String(min))
}

/**
 * Ensures value is an array
 * @param value - Value that may or may not be an array
 * @returns Value as array
 */
export function ensureArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value]
}

/**
 * Destination name aliases for normalization
 */
const DESTINATION_ALIASES: Record<string, string> = {
  'newcrlton': 'new carrollton',
  'new carrollton': 'new carrollton',
  'vienna': 'vienna',
  'vienna/fairfax-gmu': 'vienna',
  'vienna/fairfax': 'vienna',
  'ashburn': 'ashburn',
  'largo': 'largo',
  'wiehle': 'wiehle-reston east',
  'wiehle-reston': 'wiehle-reston east',
  'franconia-spfld': 'franconia-springfield',
  'franconia': 'franconia-springfield',
  'fr spgfld': 'franconia-springfield',
  'shady gr': 'shady grove',
  'shadygrove': 'shady grove',
  'glenmont': 'glenmont',
  'greenbelt': 'greenbelt',
  'branch av': 'branch ave',
  'branchave': 'branch ave',
  'huntingtn': 'huntington',
  'huntington': 'huntington',
  'mt vernon': 'mt vernon sq',
  'mt vernon sq': 'mt vernon sq',
  'mtvrnonsq': 'mt vernon sq',
}

/**
 * Display names for normalized destinations
 */
const DISPLAY_NAMES: Record<string, string> = {
  'new carrollton': 'New Carrollton',
  'vienna': 'Vienna',
  'ashburn': 'Ashburn',
  'largo': 'Largo',
  'wiehle-reston east': 'Wiehle-Reston East',
  'franconia-springfield': 'Franconia-Springfield',
  'shady grove': 'Shady Grove',
  'glenmont': 'Glenmont',
  'greenbelt': 'Greenbelt',
  'branch ave': 'Branch Ave',
  'huntington': 'Huntington',
  'mt vernon sq': 'Mt Vernon Sq',
}

/**
 * Normalizes destination name for comparison
 * @param dest - Raw destination name
 * @returns Normalized destination name
 */
export function normalizeDestination(dest: string): string {
  if (!dest) return ''
  const lower = dest.toLowerCase().trim()
  if (DESTINATION_ALIASES[lower]) return DESTINATION_ALIASES[lower]

  const normalized = lower.replace(/[\s\-\/]+/g, '')
  for (const [key, value] of Object.entries(DESTINATION_ALIASES)) {
    if (key.replace(/[\s\-\/]+/g, '') === normalized) return value
  }
  return lower
}

/**
 * Gets display name for a destination
 * @param dest - Raw destination name
 * @returns Formatted display name
 */
export function getDisplayName(dest: string): string {
  if (!dest) return ''
  if (dest === 'Check Board') return 'Check Board (GTFS)'
  const normalized = normalizeDestination(dest)
  return DISPLAY_NAMES[normalized] || dest
}
