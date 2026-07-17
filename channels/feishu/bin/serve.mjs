#!/usr/bin/env node
/**
 * grok-feishu-mcp — stdio MCP server for the Feishu channel.
 * Host launches this as an MCP subprocess. Wire protocol is CCB-compatible
 * (notifications/claude/channel*).
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = join(__dirname, '../src/run-serve.ts')
const require = createRequire(import.meta.url)

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
