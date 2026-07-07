#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(scriptDir, '../src')

const MAX_COMPLEXITY_DEFAULT = 30
const MAX_COMPLEXITY_ROUTE = 16
const MAX_FILE_LINES_DEFAULT = 700
const MAX_FILE_LINES_ROUTE = 260

const complexityOverrides = new Map([
  ['services/tripPlannerService.ts', 45],
])

const fileLineOverrides = new Map([
  ['data/carPositionService.ts', 760],
  ['services/wmata.ts', 800],
])

function isIgnored(filePath) {
  return filePath.endsWith('.d.ts')
    || filePath.includes('/dist/')
    || filePath.endsWith('.test.ts')
    || filePath.endsWith('perfBench.ts')
}

async function collectTsFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectTsFiles(fullPath))
      continue
    }
    if (!entry.name.endsWith('.ts')) continue
    if (isIgnored(fullPath)) continue
    files.push(fullPath)
  }

  return files
}

function toRel(filePath) {
  return path.relative(srcDir, filePath).replaceAll('\\', '/')
}

function getFileLineLimit(relPath) {
  if (fileLineOverrides.has(relPath)) return fileLineOverrides.get(relPath)
  if (relPath.startsWith('routes/')) return MAX_FILE_LINES_ROUTE
  return MAX_FILE_LINES_DEFAULT
}

function getComplexityLimit(relPath) {
  if (complexityOverrides.has(relPath)) return complexityOverrides.get(relPath)
  if (relPath.startsWith('routes/')) return MAX_COMPLEXITY_ROUTE
  return MAX_COMPLEXITY_DEFAULT
}

function functionName(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text
  return '<anonymous>'
}

function computeCyclomaticComplexity(node) {
  let complexity = 1

  function visit(current) {
    const nestedFunction = ts.isFunctionDeclaration(current)
      || ts.isMethodDeclaration(current)
      || ts.isArrowFunction(current)
      || ts.isFunctionExpression(current)
    if (nestedFunction && current !== node) {
      return
    }

    if (
      ts.isIfStatement(current)
      || ts.isForStatement(current)
      || ts.isForInStatement(current)
      || ts.isForOfStatement(current)
      || ts.isWhileStatement(current)
      || ts.isDoStatement(current)
      || ts.isConditionalExpression(current)
      || ts.isCatchClause(current)
    ) {
      complexity += 1
    }

    if (ts.isCaseClause(current)) {
      complexity += 1
    }

    if (ts.isBinaryExpression(current)) {
      const op = current.operatorToken.kind
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken
        || op === ts.SyntaxKind.BarBarToken
        || op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        complexity += 1
      }
    }

    ts.forEachChild(current, visit)
  }

  visit(node)
  return complexity
}

function checkImportBoundaries(relPath, sourceFile, failures) {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue

    const spec = statement.moduleSpecifier.text

    if (relPath.startsWith('services/') && spec.includes('/routes/')) {
      failures.push(`${relPath}: services layer must not import routes (${spec})`)
    }

    if (relPath === 'routes/trips.ts' && spec.startsWith('../data/')) {
      failures.push(`${relPath}: route must not import data layer directly (${spec})`)
    }

    if (relPath === 'routes/trips.ts' && spec === '../services/wmata.js') {
      failures.push(`${relPath}: route must use tripPlannerService abstraction instead of direct WMATA calls`)
    }
  }
}

function checkComplexity(relPath, sourceFile, failures) {
  const maxComplexity = getComplexityLimit(relPath)

  function inspect(node) {
    const isFunctionLike = ts.isFunctionDeclaration(node)
      || ts.isMethodDeclaration(node)
      || ts.isArrowFunction(node)
      || ts.isFunctionExpression(node)

    if (isFunctionLike && node.body) {
      const complexity = computeCyclomaticComplexity(node.body)
      if (complexity > maxComplexity) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart())
        failures.push(
          `${relPath}:${pos.line + 1}: function ${functionName(node)} complexity ${complexity} exceeds limit ${maxComplexity}`
        )
      }
    }

    ts.forEachChild(node, inspect)
  }

  inspect(sourceFile)
}

async function run() {
  const files = await collectTsFiles(srcDir)
  const failures = []

  for (const filePath of files) {
    const relPath = toRel(filePath)
    const content = await fs.readFile(filePath, 'utf8')

    const lineCount = content.split('\n').length
    const lineLimit = getFileLineLimit(relPath)
    if (lineCount > lineLimit) {
      failures.push(`${relPath}: file has ${lineCount} lines (limit ${lineLimit})`)
    }

    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    checkImportBoundaries(relPath, sourceFile, failures)
    checkComplexity(relPath, sourceFile, failures)
  }

  if (failures.length === 0) {
    console.log(`[quality-gate] PASS (${files.length} files checked)`)
    return
  }

  console.error('[quality-gate] FAIL')
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }
  process.exitCode = 1
}

await run()
