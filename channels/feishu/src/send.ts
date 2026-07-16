import { createReadStream } from 'node:fs'
import { extname, basename } from 'node:path'
import * as lark from '@larksuiteoapi/node-sdk'
import { getLarkClient } from './api.js'

function stripCodeBlocks(text: string): string {
  let result = ''
  let i = 0
  while (i < text.length) {
    if (text.startsWith('```', i)) {
      let j = i + 3
      while (j < text.length && text[j] !== '\n') j++
      if (j < text.length) j++
      const contentStart = j
      while (j < text.length) {
        if (text.startsWith('```', j)) {
          result += text.slice(contentStart, j)
          j += 3
          while (j < text.length && text[j] !== '\n') j++
          if (j < text.length) j++
          break
        }
        j++
      }
      if (j >= text.length && !text.startsWith('```', j - 3)) {
        result += text.slice(i)
      }
      i = j
    } else {
      result += text[i]
      i++
    }
  }
  return result
}

export function markdownToPlainText(text: string): string {
  return stripCodeBlocks(text)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/___(.+?)___/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[$1]')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*_]{3,}$/gm, '---')
    .replace(/^[\s]*[-*+]\s+/gm, '- ')
    .replace(/^[\s]*(\d+)\.\s+/gm, '$1. ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isImageFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)
}

export async function sendTextMessage(params: {
  appId: string
  appSecret: string
  chatId: string
  text: string
}): Promise<string> {
  const client = getLarkClient(params.appId, params.appSecret)
  const res = await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: params.chatId,
      msg_type: 'text',
      content: JSON.stringify({ text: markdownToPlainText(params.text) }),
    },
  })
  if (res.code !== 0) {
    throw new Error(
      `Failed to send Feishu message: ${res.msg} (code=${res.code})`,
    )
  }
  return res.data?.message_id ?? ''
}

export async function sendFileMessage(params: {
  appId: string
  appSecret: string
  chatId: string
  filePath: string
  text?: string
}): Promise<string> {
  const client = getLarkClient(params.appId, params.appSecret)

  if (params.text) {
    const textRes = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: params.chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: markdownToPlainText(params.text) }),
      },
    })
    if (textRes.code !== 0) {
      throw new Error(
        `Failed to send Feishu message: ${textRes.msg} (code=${textRes.code})`,
      )
    }
  }

  const fileName = basename(params.filePath)
  let msgType: string
  let content: string

  if (isImageFile(params.filePath)) {
    const uploaded = await client.im.image.create({
      data: {
        image_type: 'message',
        image: createReadStream(params.filePath),
      },
    })
    const imageKey = (uploaded as unknown as { image_key?: string })?.image_key
    if (!imageKey) {
      throw new Error('Failed to upload image: no image_key returned')
    }
    msgType = 'image'
    content = JSON.stringify({ image_key: imageKey })
  } else {
    const uploaded = await client.im.file.create({
      data: {
        file_type: 'stream',
        file_name: fileName,
        file: createReadStream(params.filePath),
      },
    })
    const fileKey = (uploaded as unknown as { file_key?: string })?.file_key
    if (!fileKey) {
      throw new Error('Failed to upload file: no file_key returned')
    }
    msgType = 'file'
    content = JSON.stringify({ file_key: fileKey, file_name: fileName })
  }

  const res = await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: { receive_id: params.chatId, msg_type: msgType, content },
  })
  if (res.code !== 0) {
    throw new Error(
      `Failed to send Feishu ${msgType}: ${res.msg} (code=${res.code})`,
    )
  }
  return res.data?.message_id ?? ''
}
