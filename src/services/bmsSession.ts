// BMS Session service — authenticates against the shared HOSxP session store.
// Protocol: see BMS-SESSION-SPECIFICATION.md

export interface BmsSessionUserInfo {
  name?: string
  location?: string
  doctor_code?: string
  bms_url?: string
  bms_session_code?: string
  'hosxp.api_url'?: string
  'hosxp.api_auth_key'?: string
}

export interface BmsSessionResponse {
  MessageCode: number
  Message?: string
  result?: {
    user_info?: BmsSessionUserInfo
    key_value?: {
      'hosxp.api_url'?: string
      'hosxp.api_auth_key'?: string
    }
  }
}

export interface BmsConnectionConfig {
  apiUrl: string | null
  apiAuthKey: string | null
}

const PASTE_JSON_URL = 'https://hosxp.net/phapi/PasteJSON'

export async function retrieveBmsSession(sessionId: string): Promise<BmsSessionResponse> {
  const res = await fetch(`${PASTE_JSON_URL}?Action=GET&code=${encodeURIComponent(sessionId)}`)
  if (!res.ok) throw new Error(`BMS session lookup failed: ${res.status}`)
  return res.json()
}

// Hierarchical fallback per spec: key_value takes precedence over user_info.
export function extractConnectionConfig(data: BmsSessionResponse): BmsConnectionConfig {
  const kv = data.result?.key_value
  const info = data.result?.user_info
  const apiUrl = kv?.['hosxp.api_url'] || info?.['hosxp.api_url'] || info?.bms_url || null
  const apiAuthKey = kv?.['hosxp.api_auth_key'] || info?.['hosxp.api_auth_key'] || info?.bms_session_code || null
  return { apiUrl, apiAuthKey }
}
