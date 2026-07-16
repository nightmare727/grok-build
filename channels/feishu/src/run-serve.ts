/**
 * Standalone MCP stdio server entry (no-op analytics deps).
 */
import { runFeishuMcpServer } from './server.js'
import { createStandaloneDeps } from './standalone-deps.js'

const version = process.env.npm_package_version ?? '0.1.0'
await runFeishuMcpServer(version, createStandaloneDeps())
