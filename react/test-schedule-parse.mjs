import { readFileSync } from 'fs'

const scheduleDataPath = '../schedule-data.js'
const fileContent = readFileSync(scheduleDataPath, 'utf-8')

const jsonMatch = fileContent.match(/const\s+SCHEDULE_CONFIG\s*=\s*(\{[\s\S]*?\n\};)/)

if (!jsonMatch) {
  console.log('No match found!')
  process.exit(1)
}

let jsonStr = jsonMatch[1].replace(/;$/, '')
jsonStr = jsonStr.replace(/\/\/[^\n]*/g, '')
jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1')
jsonStr = jsonStr.replace(/(\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*):/g, '$1"$2"$3:')

console.log('First 500 chars of cleaned JSON:')
console.log(jsonStr.substring(0, 500))

try {
  const config = JSON.parse(jsonStr)
  console.log('\n✅ Parsed successfully!')
  console.log('Number of patterns:', Object.keys(config.patterns).length)
  console.log('Sample pattern:', Object.keys(config.patterns)[0])
  console.log(JSON.stringify(config.patterns[Object.keys(config.patterns)[0]], null, 2))
} catch (error) {
  console.log('\n❌ Parse failed:', error.message)
  const pos = parseInt(error.message.match(/position (\d+)/)?.[1] || '0')
  console.log('\nContext around error position:')
  console.log(jsonStr.substring(Math.max(0, pos - 100), pos + 100))
}
