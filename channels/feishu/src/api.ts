import * as lark from '@larksuiteoapi/node-sdk'

let cachedClient: lark.Client | null = null
let cachedClientKey = ''

export function getLarkClient(appId: string, appSecret: string): lark.Client {
  const key = `${appId}:${appSecret}`
  if (!cachedClient || cachedClientKey !== key) {
    cachedClient = new lark.Client({ appId, appSecret })
    cachedClientKey = key
  }
  return cachedClient
}
