#!/usr/bin/env node
/**
 * grok-feishu-cli — setup / pair / serve for the Feishu channel MCP.
 * Runs TypeScript sources via node --import tsx (Node ≥ 18).
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = join(__dirname, '../src/run-cli.ts')
const require = createRequire(import.meta.url)

// Resolve tsx package so we work without global install.
let tsxLoader
try {
  tsxLoader = require.resolve('tsx/esm')
} catch {
  process.stderr.write(
    '[feishu] Missing dependency "tsx". Run: cd channels/feishu && npm install\n',
  )
  process.exit(1)
}

const result = spawnSync(
  process.execPath,
  ['--import', tsxLoader, entry, ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env },
)
process.exit(result.status ?? 1)
