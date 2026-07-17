/**
 * Standalone CLI entry: setup | setup clear | access pair | serve
 */
import { handleFeishuCli } from './cli.js'
import { createStandaloneDeps } from './standalone-deps.js'

const version = process.env.npm_package_version ?? '0.1.0'
await handleFeishuCli(process.argv.slice(2), createStandaloneDeps(), version)
