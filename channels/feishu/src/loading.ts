import { getLarkClient } from './api.js'
import { markdownToPlainText } from './send.js'

// In-memory map of chatId -> the loading card we last sent there. When the
// model finally calls `reply`, we patch this card in place instead of sending
// a brand-new message, so the Feishu user sees "thinking…" turn into the
// answer without any extra chatter.
type PendingCard = { messageId: string; createdAt: number }

// Cards can only be patched for 14 days; we expire much sooner so a stale
// entry never patches an unrelated, much later answer onto an old card.
const LOADING_CARD_TTL_MS = 15 * 60 * 1000
const STREAM_PATCH_INTERVAL_MS = 800

const pendingCards = new Map<string, PendingCard>()
const streamPatchTimers = new Map<string, ReturnType<typeof setTimeout>>()
const streamPatchTexts = new Map<string, string>()

const LOADING_TEXT = '⏳ Grok 正在思考…'

// `update_multi: true` is REQUIRED by Feishu for a shared card to be
// updatable via im.message.patch — without it the patch call is rejected.
function buildCardContent(content: string): string {
  return JSON.stringify({
    config: { wide_screen_mode: true, update_multi: true },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content } }],
  })
}

/**
 * Best-effort: post a "thinking…" interactive card and remember its
 * message_id for this chat. Failures (missing card permission, network) are
 * swallowed — the channel still works, just without the loading indicator.
 */
export async function sendLoadingCard(params: {
  appId: string
  appSecret: string
  chatId: string
}): Promise<void> {
  const client = getLarkClient(params.appId, params.appSecret)
  try {
    const res = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: params.chatId,
        msg_type: 'interactive',
        content: buildCardContent(LOADING_TEXT),
      },
    })
    const messageId = res.data?.message_id
    if (res.code === 0 && messageId) {
      pendingCards.set(params.chatId, { messageId, createdAt: Date.now() })
    }
  } catch (err) {
    process.stderr.write(`[feishu] Failed to send loading card: ${err}\n`)
  }
}

/**
 * If a loading card is pending for this chat, patch it with the final answer
 * and return true. Otherwise (no card, expired, or patch failed) return false
 * so the caller falls back to sending a normal message.
 */
export async function resolveLoadingCard(params: {
  appId: string
  appSecret: string
  chatId: string
  text: string
  keepPending?: boolean
}): Promise<boolean> {
  const pending = pendingCards.get(params.chatId)
  if (!pending) return false
  if (!params.keepPending) {
    const timer = streamPatchTimers.get(params.chatId)
    if (timer) {
      clearTimeout(timer)
      streamPatchTimers.delete(params.chatId)
    }
    streamPatchTexts.delete(params.chatId)
    pendingCards.delete(params.chatId)
  }
  if (Date.now() - pending.createdAt > LOADING_CARD_TTL_MS) return false

  const content = markdownToPlainText(params.text) || LOADING_TEXT
  const client = getLarkClient(params.appId, params.appSecret)
  try {
    const res = await client.im.message.patch({
      path: { message_id: pending.messageId },
      data: { content: buildCardContent(content) },
    })
    return res.code === 0
  } catch (err) {
    process.stderr.write(`[feishu] Failed to update loading card: ${err}\n`)
    return false
  }
}

export function queueLoadingCardUpdate(params: {
  appId: string
  appSecret: string
  chatId: string
  text: string
}): void {
  streamPatchTexts.set(params.chatId, params.text)
  if (streamPatchTimers.has(params.chatId)) return

  const timer = setTimeout(() => {
    streamPatchTimers.delete(params.chatId)
    const text = streamPatchTexts.get(params.chatId)
    streamPatchTexts.delete(params.chatId)
    if (!text) return

    void resolveLoadingCard({
      appId: params.appId,
      appSecret: params.appSecret,
      chatId: params.chatId,
      text,
      keepPending: true,
    })
  }, STREAM_PATCH_INTERVAL_MS)
  streamPatchTimers.set(params.chatId, timer)
}

/** Drop any pending loading card for a chat without touching Feishu. */
export function clearLoadingCard(chatId: string): void {
  const timer = streamPatchTimers.get(chatId)
  if (timer) {
    clearTimeout(timer)
    streamPatchTimers.delete(chatId)
  }
  streamPatchTexts.delete(chatId)
  pendingCards.delete(chatId)
}
