import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const FEISHU_BASE_URL = 'https://open.feishu.cn/open-apis'

export interface AccountData {
  appId: string
  appSecret: string
  savedAt: string
}

export function getStateDir(): string {
  const dir =
    process.env.FEISHU_STATE_DIR ||
    join(homedir(), '.grok', 'channels', 'feishu')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function accountPath(): string {
  return join(getStateDir(), 'account.json')
}

export function loadAccount(): AccountData | null {
  const path = accountPath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as AccountData
  } catch {
    return null
  }
}

export function saveAccount(data: AccountData): void {
  const path = accountPath()
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
  chmodSync(path, 0o600)
}

export function clearAccount(): void {
  const path = accountPath()
  if (existsSync(path)) {
    unlinkSync(path)
  }
}
