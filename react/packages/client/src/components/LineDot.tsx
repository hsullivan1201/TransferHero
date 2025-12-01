import type { Line } from '@transferhero/shared'
import { getLineDotClass } from '../utils/lineColors'

interface LineDotProps {
  line: Line
  size?: 'sm' | 'md'
}

export function LineDot({ line, size = 'md' }: LineDotProps) {
  const sizeClass = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'

  return (
    <span
      className={`${sizeClass} rounded-full inline-block border border-black/10 ${getLineDotClass(line)}`}
    />
  )
}

interface LineDotsProps {
  lines: Line[]
  size?: 'sm' | 'md'
}

export function LineDots({ lines, size = 'md' }: LineDotsProps) {
  return (
    <div className="flex gap-0.5">
      {lines.map(line => (
        <LineDot key={line} line={line} size={size} />
      ))}
    </div>
  )
}
