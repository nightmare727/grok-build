// Feishu Open Platform API types

export interface FeishuTokenResponse {
  code: number
  msg: string
  tenant_access_token: string
  expire: number
}

export interface FeishuSendMessageResponse {
  code: number
  msg: string
  data?: {
    message_id?: string
    chat_id?: string
    msg_type?: string
    content?: string
    create_time?: string
  }
}

export interface FeishuUploadImageResponse {
  code: number
  msg: string
  data?: {
    image_key?: string
  }
}

export interface FeishuUploadFileResponse {
  code: number
  msg: string
  data?: {
    file_key?: string
  }
}

// Webhook event payload (Schema 2.0)
export interface FeishuEventHeader {
  event_id: string
  token: string
  create_time: string
  event_type: string
  tenant_key: string
  app_id: string
}

export interface FeishuSenderId {
  open_id: string
  user_id?: string
  union_id?: string
}

export interface FeishuMessagePayload {
  message_id: string
  root_id?: string
  parent_id?: string
  create_time: string
  chat_id: string
  chat_type: 'p2p' | 'group'
  message_type: string
  content: string // JSON string
}

export interface FeishuSender {
  sender_id: FeishuSenderId
  sender_type: string
  tenant_key: string
}

export interface FeishuMessageReceiveEvent {
  message: FeishuMessagePayload
  sender: FeishuSender
}

export interface FeishuUrlVerificationEvent {
  challenge: string
  token: string
}

export type FeishuEventPayload =
  | FeishuMessageReceiveEvent
  | FeishuUrlVerificationEvent

export interface FeishuWebhookBody {
  // Schema 2.0
  schema?: string
  header?: FeishuEventHeader
  event?: FeishuEventPayload
  // Schema 1.0 fallback
  type?: string
  challenge?: string
  token?: string
}

// Message content (parsed from event.message.content JSON string)
export interface FeishuTextContent {
  text: string
}

export interface FeishuImageContent {
  image_key: string
}

export interface FeishuFileContent {
  file_key: string
  file_name?: string
}
