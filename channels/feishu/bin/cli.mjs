#!/usr/bin/env node
/**
 * grok-feishu-cli — setup / pair / serve for the Feishu channel MCP.
 * Runs TypeScript sources via tsx (Node ≥ 18).
 */
import { register } from 'tsx/esm/api'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

register()

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = pathToFileURL(join(__dirname, '../src/run-cli.ts')).href
await import(entry)
