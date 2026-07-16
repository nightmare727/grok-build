/**
 * No-op analytics + CCB-compatible notification handler wiring for standalone
 * MCP serve (outside Claude Code / CCB host).
 *
 * Wire protocol methods must stay CCB-compatible:
 *   notifications/claude/channel/permission_request
 *   notifications/claude/channel/assistant_delta
 */
import { z } from 'zod'
import type { FeishuServerDeps } from './server.js'

export const CHANNEL_PERMISSION_REQUEST_METHOD =
  'notifications/claude/channel/permission_request'

export const CHANNEL_ASSISTANT_DELTA_METHOD =
  'notifications/claude/channel/assistant_delta'

const ChannelPermissionRequestNotificationSchema = z.object({
  method: z.literal(CHANNEL_PERMISSION_REQUEST_METHOD),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
    channel_context: z
      .object({
        source_server: z.string().optional(),
        chat_id: z.string().optional(),
      })
      .optional(),
  }),
})

const ChannelAssistantDeltaNotificationSchema = z.object({
  method: z.literal(CHANNEL_ASSISTANT_DELTA_METHOD),
  params: z.object({
    text: z.string(),
    is_final: z.boolean().optional(),
    channel_context: z
      .object({
        source_server: z.string().optional(),
        chat_id: z.string().optional(),
      })
      .optional(),
  }),
})

export function createStandaloneDeps(): FeishuServerDeps {
  return {
    enableConfigs() {},
    initializeAnalyticsSink() {},
    async shutdownDatadog() {},
    async shutdown1PEventLogging() {},
    logForDebugging(message: string) {
      process.stderr.write(`${message}\n`)
    },
    registerPermissionHandler(server, handler) {
      // MCP SDK expects a Zod schema with a method literal.
      server.setNotificationHandler(
        ChannelPermissionRequestNotificationSchema as never,
        async notification => {
          const params = (
            notification as z.infer<
              typeof ChannelPermissionRequestNotificationSchema
            >
          ).params
          await handler(params)
        },
      )
    },
    registerAssistantDeltaHandler(server, handler) {
      server.setNotificationHandler(
        ChannelAssistantDeltaNotificationSchema as never,
        async notification => {
          const params = (
            notification as z.infer<
              typeof ChannelAssistantDeltaNotificationSchema
            >
          ).params
          await handler(params)
        },
      )
    },
  }
}
