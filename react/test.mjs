import { readFileSync } from 'fs'

const fileContent = readFileSync('../schedule-data.js', 'utf-8')
const jsonMatch = fileContent.match(/const\s+SCHEDULE_CONFIG\s*=\s*(\{[\s\S]*?\n\};)/)

let jsonStr = jsonMatch[1].replace(/;$/, '')
jsonStr = jsonStr.replace(/\/\/[^\n]*/g, '')
jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1')
jsonStr = jsonStr.replace(/(\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*):/g, '$1"$2"$3:')
jsonStr = jsonStr.replace(/'/g, '"')

try {
  const config = JSON.parse(jsonStr)
  console.log('✅ Parsed successfully!')
  console.log('Number of patterns:', Object.keys(config.patterns).length)
  const firstKey = Object.keys(config.patterns)[0]
  console.log('First pattern:', firstKey)
  console.log(JSON.stringify(config.patterns[firstKey], null, 2))
} catch (error) {
  console.log('❌ Parse failed:', error.message)
}
