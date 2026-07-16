#!/usr/bin/env node
/**
 * grok-feishu-mcp — stdio MCP server for the Feishu channel.
 * Host launches this as an MCP subprocess. Wire protocol is CCB-compatible
 * (notifications/claude/channel*).
 */
import { register } from 'tsx/esm/api'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

register()

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = pathToFileURL(join(__dirname, '../src/run-serve.ts')).href
await import(entry)
