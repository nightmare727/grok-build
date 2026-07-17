import { existsSync } from 'node:fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { loadAccount } from './accounts.js'
import {
  queueLoadingCardUpdate,
  resolveLoadingCard,
  sendLoadingCard,
} from './loading.js'
import {
  getActivePermissionChat,
  savePendingPermission,
} from './permissions.js'
import { sendFileMessage, sendTextMessage } from './send.js'
import { startLongConnection } from './webhook.js'
import type { ParsedMessage } from './webhook.js'
import type { ChannelPermissionRequestParams } from './permissions.js'

export type ChannelAssistantDeltaParams = {
  text: string
  is_final?: boolean
  channel_context?: {
    source_server?: string
    chat_id?: string
  }
}

export interface FeishuServerDeps {
  enableConfigs(): void
  initializeAnalyticsSink(): void
  shutdownDatadog(): Promise<void>
  shutdown1PEventLogging(): Promise<void>
  logForDebugging(message: string): void
  registerPermissionHandler(
    server: Server,
    handler: (request: ChannelPermissionRequestParams) => Promise<void>,
  ): void
  registerAssistantDeltaHandler(
    server: Server,
    handler: (request: ChannelAssistantDeltaParams) => Promise<void>,
  ): void
}

function formatPermissionRequestMessage(
  request: ChannelPermissionRequestParams,
): string {
  return [
    'Grok needs your approval.',
    '',
    `Tool: ${request.tool_name}`,
    `Reason: ${request.description}`,
    `Input: ${request.input_preview}`,
    '',
    `Reply with: yes ${request.request_id}`,
    `Or deny with: no ${request.request_id}`,
  ].join('\n')
}

export function getFeishuToolDefinitions() {
  return [
    {
      name: 'reply',
      description:
        'Reply to a Feishu message. Pass the chat_id from the channel tag.',
      _meta: { 'anthropic/alwaysLoad': true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: {
            type: 'string',
            description: 'The chat_id from the channel notification',
          },
          text: { type: 'string', description: 'The reply text' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional absolute file paths to attach',
          },
        },
        required: ['chat_id', 'text'],
      },
    },
  ]
}

export function createFeishuMcpServer(version: string): Server {
  const server = new Server(
    { name: 'feishu', version },
    {
      capabilities: {
        experimental: {
          'claude/channel': {},
          'claude/channel/permission': {},
          'claude/channel/assistant_delta': {},
        },
        tools: {},
      },
      instructions:
        'Messages from Feishu arrive as <channel source="plugin:feishu:feishu" chat_id="..." sender_id="...">. Reply using the reply tool with the chat_id from the channel tag. Use absolute paths for file attachments.',
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getFeishuToolDefinitions(),
  }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params
    const account = loadAccount()
    if (!account) {
      return {
        content: [
          {
            type: 'text',
            text: 'Feishu not configured. Run `node bin/cli.mjs setup` first.',
          },
        ],
        isError: true,
      }
    }

    if (name === 'reply') {
      const chatId = typeof args?.chat_id === 'string' ? args.chat_id : ''
      const text = typeof args?.text === 'string' ? args.text : ''
      const files = Array.isArray(args?.files)
        ? args.files.filter((v): v is string => typeof v === 'string')
        : []

      if (!chatId || !text) {
        return {
          content: [
            { type: 'text', text: 'Missing chat_id or text parameter.' },
          ],
          isError: true,
        }
      }

      try {
        if (files.length > 0) {
          // Show the text answer first. Reuse the pending loading card if there
          // is one; only fall back to attaching the text on the first file when
          // no card was updated.
          const cardUpdated = await resolveLoadingCard({
            appId: account.appId,
            appSecret: account.appSecret,
            chatId,
            text,
          })
          for (const [index, filePath] of files.entries()) {
            if (!existsSync(filePath)) {
              return {
                content: [
                  { type: 'text', text: `File not found: ${filePath}` },
                ],
                isError: true,
              }
            }
            await sendFileMessage({
              appId: account.appId,
              appSecret: account.appSecret,
              chatId,
              filePath,
              text: !cardUpdated && index === 0 ? text : undefined,
            })
          }
          return {
            content: [{ type: 'text', text: 'Message sent with attachments.' }],
          }
        }

        // Patch the "thinking…" card in place if present; otherwise send a
        // fresh text message.
        const cardUpdated = await resolveLoadingCard({
          appId: account.appId,
          appSecret: account.appSecret,
          chatId,
          text,
        })
        if (!cardUpdated) {
          await sendTextMessage({
            appId: account.appId,
            appSecret: account.appSecret,
            chatId,
            text,
          })
        }
        return { content: [{ type: 'text', text: 'Message sent.' }] }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to send: ${error}` }],
          isError: true,
        }
      }
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    }
  })

  return server
}

export async function runFeishuMcpServer(
  version: string,
  deps: FeishuServerDeps,
): Promise<void> {
  deps.enableConfigs()
  deps.initializeAnalyticsSink()

  const account = loadAccount()
  if (!account) {
    process.stderr.write(
      '[feishu] No account configured. Run `node bin/cli.mjs setup` first.\n',
    )
    await Promise.all([deps.shutdown1PEventLogging(), deps.shutdownDatadog()])
    process.exit(1)
  }

  const server = createFeishuMcpServer(version)
  const transport = new StdioServerTransport()

  deps.registerPermissionHandler(server, async request => {
    const targetChatId = request.channel_context?.chat_id
    const activeChat = getActivePermissionChat()
    const chatId = targetChatId ?? activeChat?.chatId

    if (!chatId) {
      deps.logForDebugging(
        `[Feishu MCP] No active chat available for permission request ${request.request_id}`,
      )
      return
    }

    try {
      savePendingPermission(request, chatId)
      await sendTextMessage({
        appId: account.appId,
        appSecret: account.appSecret,
        chatId,
        text: formatPermissionRequestMessage(request),
      })
    } catch (error) {
      process.stderr.write(
        `[feishu] Failed to relay permission request ${request.request_id}: ${error}\n`,
      )
    }
  })
  deps.registerAssistantDeltaHandler(server, async request => {
    const chatId = request.channel_context?.chat_id
    if (!chatId || !request.text) return

    if (request.is_final) {
      await resolveLoadingCard({
        appId: account.appId,
        appSecret: account.appSecret,
        chatId,
        text: request.text,
      })
      return
    }

    queueLoadingCardUpdate({
      appId: account.appId,
      appSecret: account.appSecret,
      chatId,
      text: request.text,
    })
  })

  await server.connect(transport)

  const controller = new AbortController()

  let exiting = false
  const shutdownAndExit = async (): Promise<void> => {
    if (exiting) return
    exiting = true
    if (!controller.signal.aborted) {
      controller.abort()
    }
    await Promise.all([deps.shutdown1PEventLogging(), deps.shutdownDatadog()])
    process.exit(0)
  }

  process.stdin.on('end', () => void shutdownAndExit())
  process.stdin.on('error', () => void shutdownAndExit())
  process.on('SIGINT', () => void shutdownAndExit())
  process.on('SIGTERM', () => void shutdownAndExit())
  process.on('SIGHUP', () => void shutdownAndExit())

  const ppid = process.ppid
  const parentCheck = setInterval(() => {
    try {
      process.kill(ppid, 0)
    } catch {
      process.stderr.write('[feishu] Parent process exited, shutting down...\n')
      clearInterval(parentCheck)
      void shutdownAndExit()
    }
  }, 5000)

  startLongConnection({
    appId: account.appId,
    appSecret: account.appSecret,
    abortSignal: controller.signal,
    onMessage: async (msg: ParsedMessage) => {
      // Post a "thinking…" card immediately so the Feishu user sees feedback
      // while the model works. The `reply` tool later patches this same card
      // with the answer. Best-effort — failures never block the notification.
      await sendLoadingCard({
        appId: account.appId,
        appSecret: account.appSecret,
        chatId: msg.chatId,
      })
      await server.notification({
        method: 'notifications/claude/channel',
        params: {
          content: msg.text,
          allow_slash_commands: true,
          meta: {
            chat_id: msg.chatId,
            sender_id: msg.senderId,
            message_id: msg.messageId,
            ...(msg.attachmentPath && { attachment_path: msg.attachmentPath }),
            ...(msg.attachmentType && { attachment_type: msg.attachmentType }),
          },
        },
      })
    },
    onPermissionResponse: async response => {
      await server.notification({
        method: 'notifications/claude/channel/permission',
        params: {
          request_id: response.requestId,
          behavior: response.behavior,
        },
      })
    },
  })

  deps.logForDebugging('[Feishu MCP] Server ready')

  // Keep process alive until abort signal fires (long connection is non-blocking)
  await new Promise<void>(resolve => {
    controller.signal.addEventListener('abort', () => resolve(), { once: true })
  })

  clearInterval(parentCheck)
  await shutdownAndExit()
}
