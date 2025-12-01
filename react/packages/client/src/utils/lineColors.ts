import type { Line } from '@transferhero/shared'

export const LINE_COLORS: Record<Line, { bg: string; text: string; border: string }> = {
  RD: { bg: '#E31837', text: 'white', border: '#a00f24' },
  OR: { bg: '#F7941E', text: 'white', border: '#c77616' },
  SV: { bg: '#A1A2A1', text: 'white', border: '#6e6f6e' },
  BL: { bg: '#0076C0', text: 'white', border: '#004d82' },
  YL: { bg: '#FFD200', text: '#333', border: '#ccaa00' },
  GR: { bg: '#00A94F', text: 'white', border: '#007135' },
}

export function getLineClass(line: Line | null | undefined): string {
  if (!line) return ''
  return `train-card-${line.toLowerCase()}`
}

export function getLineDotClass(line: Line): string {
  return `line-${line.toLowerCase()}`
}
