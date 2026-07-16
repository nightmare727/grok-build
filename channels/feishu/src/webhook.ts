import * as lark from '@larksuiteoapi/node-sdk'
import { getLarkClient } from './api.js'
import { addPendingPairing, isAllowed } from './pairing.js'
import {
  consumePendingPermission,
  setActivePermissionChat,
} from './permissions.js'
import { sendTextMessage } from './send.js'

const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

export function extractPermissionReply(
  text: string,
): { requestId: string; behavior: 'allow' | 'deny' } | null {
  const match = text.match(PERMISSION_REPLY_RE)
  if (!match) return null
  const behavior = match[1]?.toLowerCase().startsWith('y') ? 'allow' : 'deny'
  const requestId = match[2]?.toLowerCase()
  if (!requestId) return null
  return { requestId, behavior }
}

export interface ParsedMessage {
  chatId: string
  senderId: string
  messageId: string
  text: string
  attachmentPath?: string
  attachmentType?: string
}

export type OnMessageCallback = (msg: ParsedMessage) => Promise<void>

export type PermissionResponse = {
  requestId: string
  behavior: 'allow' | 'deny'
  chatId: string
}

export type OnPermissionResponseCallback = (
  response: PermissionResponse,
) => Promise<void>

async function downloadAttachment(params: {
  client: lark.Client
  messageId: string
  fileKey: string
  msgType: 'image' | 'file'
  fileName?: string
}): Promise<string | null> {
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { existsSync, mkdirSync, writeFileSync } = await import('node:fs')

  try {
    const dir = join(tmpdir(), `feishu-${params.msgType}s`)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const res = await params.client.im.messageResource.get({
      path: { message_id: params.messageId, file_key: params.fileKey },
      params: { type: params.msgType },
    })

    const fileName =
      params.fileName ??
      `${params.fileKey}${params.msgType === 'image' ? '.jpg' : ''}`
    const filePath = join(dir, fileName)

    const data = res as unknown as Response
    if (data && typeof data.arrayBuffer === 'function') {
      const buf = await data.arrayBuffer()
      writeFileSync(filePath, Buffer.from(buf))
      return filePath
    }
  } catch (err) {
    process.stderr.write(
      `[feishu] Failed to download ${params.msgType} attachment ${params.fileKey}: ${err}\n`,
    )
  }
  return null
}

export function startLongConnection(params: {
  appId: string
  appSecret: string
  onMessage: OnMessageCallback
  onPermissionResponse?: OnPermissionResponseCallback
  abortSignal: AbortSignal
}): void {
  const { appId, appSecret, onMessage, onPermissionResponse, abortSignal } =
    params

  const client = getLarkClient(appId, appSecret)

  const wsClient = new lark.WSClient({
    appId,
    appSecret,
    loggerLevel: lark.LoggerLevel.warn,
  })

  const dispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async data => {
      const message = data.message
      const sender = data.sender
      const chatId = message.chat_id
      const senderId = sender.sender_id?.open_id ?? ''

      if (!chatId || !senderId) return

      if (!isAllowed(senderId)) {
        const code = addPendingPairing(senderId)
        try {
          await sendTextMessage({
            appId,
            appSecret,
            chatId,
            text: `Your pairing code is: ${code}\n\nAsk the operator to confirm:\nnode bin/cli.mjs access pair ${code}`,
          })
        } catch (err) {
          process.stderr.write(`[feishu] Failed to send pairing code: ${err}\n`)
        }
        return
      }

      setActivePermissionChat(chatId)

      let text = ''
      let attachmentPath: string | undefined
      let attachmentType: string | undefined

      const msgType = message.message_type
      const rawContent = message.content ?? '{}'

      if (msgType === 'text') {
        try {
          const parsed = JSON.parse(rawContent) as { text?: string }
          text = parsed.text ?? ''
        } catch {
          text = rawContent
        }
      } else if (msgType === 'image') {
        try {
          const parsed = JSON.parse(rawContent) as { image_key?: string }
          if (parsed.image_key) {
            const path = await downloadAttachment({
              client,
              messageId: message.message_id,
              fileKey: parsed.image_key,
              msgType: 'image',
            })
            if (path) {
              attachmentPath = path
              attachmentType = 'image'
              text = '(image attachment)'
            }
          }
        } catch {
          text = '(image)'
        }
      } else if (msgType === 'file') {
        try {
          const parsed = JSON.parse(rawContent) as {
            file_key?: string
            file_name?: string
          }
          if (parsed.file_key) {
            const path = await downloadAttachment({
              client,
              messageId: message.message_id,
              fileKey: parsed.file_key,
              msgType: 'file',
              fileName: parsed.file_name,
            })
            if (path) {
              attachmentPath = path
              attachmentType = 'file'
              text = '(file attachment)'
            }
          }
        } catch {
          text = '(file)'
        }
      } else {
        return
      }

      if (!text && !attachmentPath) return

      if (text && onPermissionResponse) {
        const reply = extractPermissionReply(text)
        if (reply) {
          const pending = consumePendingPermission(reply.requestId, chatId)
          if (pending) {
            await onPermissionResponse({
              requestId: pending.request_id,
              behavior: reply.behavior,
              chatId,
            })
            return
          }
        }
      }

      await onMessage({
        chatId,
        senderId,
        messageId: message.message_id,
        text: text || '(media attachment)',
        attachmentPath,
        attachmentType,
      })
    },
  })

  process.stderr.write(
    '[feishu] Connecting via long connection (WebSocket)...\n',
  )

  wsClient.start({ eventDispatcher: dispatcher })

  abortSignal.addEventListener('abort', () => {
    try {
      ;(wsClient as unknown as { stop?: () => void }).stop?.()
    } catch {
      // ignore
    }
  })
}
