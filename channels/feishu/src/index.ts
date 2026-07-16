// @xai/grok-feishu-channel — Feishu (Lark) channel integration (vendored from CCB)

// Types
export type {
  FeishuTokenResponse,
  FeishuSendMessageResponse,
  FeishuUploadImageResponse,
  FeishuUploadFileResponse,
  FeishuEventHeader,
  FeishuSenderId,
  FeishuMessagePayload,
  FeishuSender,
  FeishuMessageReceiveEvent,
  FeishuUrlVerificationEvent,
  FeishuEventPayload,
  FeishuWebhookBody,
  FeishuTextContent,
  FeishuImageContent,
  FeishuFileContent,
} from './types.js'

// Account management
export {
  FEISHU_BASE_URL,
  getStateDir,
  loadAccount,
  saveAccount,
  clearAccount,
} from './accounts.js'
export type { AccountData } from './accounts.js'

// API client
export { getLarkClient } from './api.js'

// Pairing / access control
export {
  loadAccessConfig,
  saveAccessConfig,
  isAllowed,
  addPendingPairing,
  confirmPairing,
} from './pairing.js'
export type { AccessConfig } from './pairing.js'

// Permission state
export {
  setActivePermissionChat,
  getActivePermissionChat,
  savePendingPermission,
  consumePendingPermission,
} from './permissions.js'
export type {
  ChannelPermissionRequestParams,
  PendingPermissionRequest,
  ActivePermissionChat,
} from './permissions.js'

// Message sending
export {
  markdownToPlainText,
  sendTextMessage,
  sendFileMessage,
} from './send.js'

// Long connection (WebSocket)
export {
  extractPermissionReply,
  startLongConnection,
} from './webhook.js'
export type {
  ParsedMessage,
  OnMessageCallback,
  PermissionResponse,
  OnPermissionResponseCallback,
} from './webhook.js'

// Loading-state card (thinking… → answer, patched in place)
export {
  sendLoadingCard,
  resolveLoadingCard,
  clearLoadingCard,
} from './loading.js'

// MCP server
export { createFeishuMcpServer, runFeishuMcpServer } from './server.js'
export type { FeishuServerDeps } from './server.js'

// CLI
export { handleFeishuCli } from './cli.js'
