import { clearAccount, loadAccount, saveAccount } from './accounts.js'
import { confirmPairing } from './pairing.js'
import { runFeishuMcpServer } from './server.js'
import type { FeishuServerDeps } from './server.js'

function printUsage(): void {
  process.stdout.write(
    [
      'Usage:',
      '  grok-feishu-cli serve',
      '  grok-feishu-cli setup',
      '  grok-feishu-cli setup clear',
      '  grok-feishu-cli access pair <code>',
      '',
      'Or via package bin:',
      '  node bin/cli.mjs <command>',
      '  node bin/serve.mjs',
      '',
      'Session enablement (host; local build, not official grok):',
      '  grok-local --channels feishu',
      '',
      'State dir: $FEISHU_STATE_DIR or ~/.grok/channels/feishu',
    ].join('\n') + '\n',
  )
}

async function runSetup(clear = false): Promise<void> {
  if (clear) {
    clearAccount()
    process.stdout.write('Feishu account cleared.\n')
    return
  }

  const existing = loadAccount()
  if (existing) {
    process.stdout.write(
      [
        'Already configured:',
        `  App ID: ${existing.appId}`,
        `  Configured since: ${existing.savedAt}`,
        '',
        'Run `node bin/cli.mjs setup clear` to remove configuration.',
        'Start the channel with:',
        '  node bin/serve.mjs',
        '  # or from host: grok-local --channels feishu',
      ].join('\n') + '\n',
    )
    return
  }

  // Interactive setup
  const readline = await import('node:readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const ask = (q: string): Promise<string> =>
    new Promise(resolve => rl.question(q, resolve))

  process.stdout.write('\nFeishu Channel Setup\n')
  process.stdout.write('====================\n')
  process.stdout.write('You need a Feishu app at https://open.feishu.cn/\n')
  process.stdout.write(
    'Uses long connection (WebSocket) — no public URL needed.\n\n',
  )

  const appId = (await ask('App ID (cli_xxx): ')).trim()
  const appSecret = (await ask('App Secret: ')).trim()

  rl.close()

  if (!appId || !appSecret) {
    process.stderr.write('App ID and App Secret are required.\n')
    process.exit(1)
  }

  saveAccount({
    appId,
    appSecret,
    savedAt: new Date().toISOString(),
  })

  process.stdout.write(
    [
      '',
      'Configured successfully!',
      '',
      'Next steps:',
      '1. In Feishu Open Platform, enable "Using long connection to receive events"',
      '   (事件订阅 → 长连接接收事件)',
      '2. Subscribe to event: im.message.receive_v1',
      '3. Add bot to a group or start a direct conversation',
      '4. Start the MCP server:',
      '   node bin/serve.mjs',
      '   # or from host: grok-local --channels feishu',
    ].join('\n') + '\n',
  )
}

function runAccess(args: string[]): void {
  if (args[0] !== 'pair' || !args[1]) {
    printUsage()
    process.exit(1)
  }

  const userId = confirmPairing(args[1])
  if (!userId) {
    process.stderr.write('Invalid or expired pairing code.\n')
    process.exit(1)
  }

  process.stdout.write(`Paired successfully: ${userId}\n`)
}

export async function handleFeishuCli(
  args: string[],
  serverDeps?: FeishuServerDeps,
  version?: string,
): Promise<void> {
  const [subcommand, ...rest] = args

  switch (subcommand) {
    case 'serve':
      if (!serverDeps) {
        process.stderr.write(
          '[feishu] serve handler not available in this context.\n',
        )
        process.exit(1)
      }
      await runFeishuMcpServer(version ?? '0.0.0', serverDeps)
      return
    case 'setup':
      await runSetup(rest[0] === 'clear')
      return
    case 'access':
      runAccess(rest)
      return
    default:
      printUsage()
      process.exit(subcommand ? 1 : 0)
  }
}
