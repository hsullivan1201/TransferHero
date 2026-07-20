import type { Line } from '@transferhero/shared'

/** Deliberate, non-geographic coordinates for the fixed WMATA rail topology. */
export interface SchematicPoint {
  x: number
  y: number
}

/**
 * Platform codes that belong to one physical transfer station. Keeping these
 * groups explicit avoids merging unrelated nearby stops or relying on names.
 */
export const PHYSICAL_STATION_GROUPS = [
  ['A01', 'C01'],
  ['B01', 'F01'],
  ['D03', 'F03'],
  ['B06', 'E06'],
] as const

/** WMATA's visual stacking order: Red, Yellow, Green, Orange, Silver, Blue. */
export const LINE_DRAW_ORDER: readonly Line[] = ['RD', 'YL', 'GR', 'OR', 'SV', 'BL']

/** Small fixed offsets keep shared service corridors visibly parallel. */
export const LINE_OFFSETS: Readonly<Record<Line, SchematicPoint>> = {
  RD: { x: 0, y: 0 },
  YL: { x: -5, y: 0 },
  GR: { x: 5, y: 0 },
  OR: { x: 0, y: -8 },
  SV: { x: 0, y: 0 },
  BL: { x: 0, y: 8 },
}

/**
 * The map is octilinear: adjoining stations are horizontal, vertical, or 45°.
 * Coordinates follow the real line order, branches, shared trunks, and transfer
 * nodes while intentionally avoiding a misleading geographic projection.
 */
export const SCHEMATIC_STATIONS: Readonly<Record<string, SchematicPoint>> = {
  // Red — Shady Grove side to Metro Center.
  A15: { x: 80, y: 40 },
  A14: { x: 120, y: 80 },
  A13: { x: 160, y: 120 },
  A12: { x: 200, y: 160 },
  A11: { x: 240, y: 200 },
  A10: { x: 270, y: 230 },
  A09: { x: 300, y: 260 },
  A08: { x: 330, y: 290 },
  A07: { x: 360, y: 320 },
  A06: { x: 390, y: 350 },
  A05: { x: 420, y: 380 },
  A04: { x: 450, y: 410 },
  A03: { x: 480, y: 440 },
  A02: { x: 510, y: 470 },
  A01: { x: 540, y: 500 },
  C01: { x: 540, y: 500 },

  // Red — Gallery Place side to Glenmont. The branch stays due north past
  // Fort Totten, west of the Green/Yellow Greenbelt branch, as on the real map.
  B01: { x: 600, y: 440 },
  B02: { x: 620, y: 420 },
  B03: { x: 640, y: 400 },
  B35: { x: 660, y: 380 },
  B04: { x: 680, y: 360 },
  B05: { x: 680, y: 280 },
  B06: { x: 680, y: 200 },
  B07: { x: 680, y: 150 },
  B08: { x: 680, y: 100 },
  B09: { x: 680, y: 50 },
  B10: { x: 680, y: 0 },
  B11: { x: 680, y: -50 },

  // Orange/Silver — Virginia shared trunk and Orange's Vienna branch.
  K08: { x: 90, y: 450 },
  K07: { x: 130, y: 410 },
  K06: { x: 170, y: 370 },
  K05: { x: 210, y: 330 },
  K04: { x: 250, y: 370 },
  K03: { x: 290, y: 410 },
  K02: { x: 330, y: 450 },
  K01: { x: 350, y: 470 },

  // Silver — Ashburn branch through Tysons. Runs west from East Falls Church,
  // well north of Orange's Vienna branch and clear of the Red line.
  N12: { x: -320, y: 250 },
  N11: { x: -270, y: 250 },
  N10: { x: -220, y: 250 },
  N09: { x: -170, y: 250 },
  N08: { x: -120, y: 250 },
  N07: { x: -70, y: 250 },
  N06: { x: -20, y: 250 },
  N04: { x: 30, y: 250 },
  N03: { x: 80, y: 250 },
  N02: { x: 130, y: 250 },
  N01: { x: 170, y: 290 },

  // Orange/Silver/Blue — Rosslyn through Stadium-Armory.
  C05: { x: 380, y: 500 },
  C04: { x: 420, y: 500 },
  C03: { x: 460, y: 500 },
  C02: { x: 500, y: 500 },
  D01: { x: 580, y: 500 },
  D02: { x: 620, y: 500 },
  D03: { x: 660, y: 500 },
  D04: { x: 700, y: 500 },
  D05: { x: 740, y: 500 },
  D06: { x: 780, y: 500 },
  D07: { x: 820, y: 500 },
  D08: { x: 860, y: 500 },

  // Orange/Silver — New Carrollton branch.
  D09: { x: 900, y: 460 },
  D10: { x: 940, y: 420 },
  D11: { x: 980, y: 380 },
  D12: { x: 1020, y: 340 },
  D13: { x: 1060, y: 300 },

  // Silver/Blue — Downtown Largo branch.
  G01: { x: 900, y: 540 },
  G02: { x: 940, y: 580 },
  G03: { x: 980, y: 620 },
  G04: { x: 1020, y: 660 },
  G05: { x: 1060, y: 700 },

  // Blue/Yellow — Pentagon through King St, with line-specific tails.
  C06: { x: 420, y: 540 },
  C07: { x: 460, y: 580 },
  C08: { x: 460, y: 620 },
  C09: { x: 460, y: 660 },
  C10: { x: 460, y: 700 },
  C11: { x: 420, y: 740 },
  C12: { x: 380, y: 780 },
  C13: { x: 340, y: 820 },
  J02: { x: 300, y: 860 },
  J03: { x: 260, y: 900 },
  C14: { x: 340, y: 860 },
  C15: { x: 300, y: 900 },

  // Green/Yellow — Greenbelt through L'Enfant Plaza. The Greenbelt branch
  // climbs northeast from Fort Totten, east of the Red line's Glenmont run.
  E10: { x: 840, y: 40 },
  E09: { x: 800, y: 80 },
  E08: { x: 760, y: 120 },
  E07: { x: 720, y: 160 },
  E06: { x: 680, y: 200 },
  E05: { x: 640, y: 240 },
  E04: { x: 600, y: 280 },
  E03: { x: 600, y: 320 },
  E02: { x: 600, y: 360 },
  E01: { x: 600, y: 400 },
  F01: { x: 600, y: 440 },
  F02: { x: 630, y: 470 },
  F03: { x: 660, y: 500 },

  // Green — Branch Avenue branch.
  F04: { x: 700, y: 540 },
  F05: { x: 740, y: 580 },
  F06: { x: 780, y: 620 },
  F07: { x: 820, y: 660 },
  F08: { x: 860, y: 700 },
  F09: { x: 900, y: 740 },
  F10: { x: 940, y: 780 },
  F11: { x: 980, y: 820 },
}

/** Extra corners for station pairs whose faithful route needs more than one leg. */
export const SCHEMATIC_BENDS: Readonly<Record<string, readonly SchematicPoint[]>> = {
  'F03>C07': [{ x: 580, y: 580 }],
  'C07>F03': [{ x: 580, y: 580 }],
}
