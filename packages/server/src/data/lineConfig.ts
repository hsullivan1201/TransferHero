import type { Line, Termini } from '@transferhero/shared'

/**
 * Ordered revenue-service paths for each line (first = toward_a, last =
 * toward_b). A line may have more than one path when trains branch. Keeping
 * branches separate is important: membership in the same line is not proof
 * that one train can travel between two stations on different branches.
 */
export const LINE_PATHS: Record<Line, string[][]> = {
  'RD': [
    ['A15','A14','A13','A12','A11','A10','A09','A08','A07','A06','A05','A04','A03','A02','A01','B01','B02','B03','B35','B04','B05','B06','B07','B08','B09','B10','B11']
  ],
  'OR': [
    ['K08','K07','K06','K05','K04','K03','K02','K01','C05','C04','C03','C02','A01','D01','D02','D03','D04','D05','D06','D07','D08','D09','D10','D11','D12','D13']
  ],
  'SV': [
    ['N12','N11','N10','N09','N08','N07','N06','N04','N03','N02','N01','K05','K04','K03','K02','K01','C05','C04','C03','C02','A01','D01','D02','D03','D04','D05','D06','D07','D08','G01','G02','G03','G04','G05'],
    ['N12','N11','N10','N09','N08','N07','N06','N04','N03','N02','N01','K05','K04','K03','K02','K01','C05','C04','C03','C02','A01','D01','D02','D03','D04','D05','D06','D07','D08','D09','D10','D11','D12','D13']
  ],
  'BL': [
    ['J03','J02','C13','C12','C11','C10','C09','C08','C07','C06','C05','C04','C03','C02','A01','D01','D02','D03','D04','D05','D06','D07','D08','G01','G02','G03','G04','G05']
  ],
  'YL': [
    ['C15','C14','C13','C12','C11','C10','C09','C08','C07','F03','F02','F01','E01','E02','E03','E04','E05','E06','E07','E08','E09','E10']
  ],
  'GR': [
    ['F11','F10','F09','F08','F07','F06','F05','F04','F03','F02','F01','E01','E02','E03','E04','E05','E06','E07','E08','E09','E10']
  ],
}

/**
 * Union of stations served by each line. This is for membership checks only;
 * callers that need an ordered route must select a path from LINE_PATHS.
 */
export const LINE_STATIONS = Object.fromEntries(
  Object.entries(LINE_PATHS).map(([line, paths]) => [
    line,
    [...new Set(paths.flat())]
  ])
) as Record<Line, string[]>

/**
 * Terminus stations for each line direction
 */
export const TERMINI: Record<Line, Termini> = {
  'RD': {
    // Friendship Heights / North Bethesda: summer 2026 shutdown short turns
    // (line severed between A08 and A12 thru Sept 6)
    toward_a: ['Shady Grove', 'Silver Spring', 'Grosvenor-Strathmore', 'Farragut North', 'Friendship Heights'],
    toward_b: ['Glenmont', 'NoMa-Gallaudet U', 'Fort Totten', 'Farragut North', 'North Bethesda']
  },
  'OR': {
    toward_a: ['Vienna'],
    toward_b: ['New Carrollton']
  },
  'SV': {
    toward_a: ['Ashburn'],
    toward_b: ['Downtown Largo', 'New Carrollton']
  },
  'BL': {
    toward_a: ['Franconia-Springfield', 'Pentagon City'],
    toward_b: ['Downtown Largo', 'Reagan National Airport']
  },
  'YL': {
    toward_a: ['Huntington', 'Pentagon City'],
    toward_b: ['Mt Vernon Sq', 'Greenbelt', 'Reagan National Airport']
  },
  'GR': {
    toward_a: ['Branch Ave'],
    toward_b: ['Greenbelt']
  },
}
