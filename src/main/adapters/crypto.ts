import { createHash, createHmac } from 'node:crypto'

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function md5Hex(data: Uint8Array): string {
  return createHash('md5').update(data).digest('hex')
}

function hmacSha256(key: Uint8Array, message: string): Buffer {
  return createHmac('sha256', key).update(message, 'utf8').digest()
}

export function hmacSha1Base64(key: string, message: string): string {
  return createHmac('sha1', key).update(message, 'utf8').digest('base64')
}

function toHex(buffer: Buffer): string {
  return buffer.toString('hex')
}

/** CRC32（十六进制，8 位，用于字节跳动 TOS 上传） */
export function crc32Hex(data: Uint8Array): string {
  let crc = 0xffffffff
  const t = table()
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ t[(crc ^ data[i]) & 0xff]
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

let CRC_TABLE: Uint32Array | null = null
function table(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE
  CRC_TABLE = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    CRC_TABLE[i] = c
  }
  return CRC_TABLE
}

export interface AWS4Params {
  method: string
  url: string
  accessKeyId: string
  secretAccessKey: string
  securityToken?: string
  region?: string
  service?: string
  headers?: Record<string, string>
  body?: string
}

function formatAmzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '')
}
function formatDateStamp(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

/** AWS4-HMAC-SHA256 签名（用于字节跳动 ImageX 图片上传） */
export function signAWS4(params: AWS4Params): { headers: Record<string, string> } {
  const {
    method,
    url,
    accessKeyId,
    secretAccessKey,
    securityToken,
    region = 'cn-north-1',
    service = 'imagex',
    headers = {},
    body = ''
  } = params

  const parsed = new URL(url)
  const path = parsed.pathname || '/'
  const query = new URLSearchParams(parsed.search.slice(1))
  const canonicalQuery = [...query.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const now = new Date()
  const amzDate = formatAmzDate(now)
  const dateStamp = formatDateStamp(now)

  const signed: Record<string, string> = { 'x-amz-date': amzDate }
  if (securityToken) signed['x-amz-security-token'] = securityToken
  Object.assign(signed, headers)

  const signedHeaderNames = Object.keys(signed)
    .map((k) => k.toLowerCase())
    .sort()
    .join(';')

  const canonicalHeaders =
    Object.entries(signed)
      .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`)
      .sort()
      .join('\n') + '\n'

  const payloadHash = sha256Hex(body)
  const canonicalRequest = [
    method.toUpperCase(),
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames,
    payloadHash
  ].join('\n')

  const algorithm = 'AWS4-HMAC-SHA256'
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n')

  const kDate = hmacSha256(Buffer.from(`AWS4${secretAccessKey}`, 'utf8'), dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  const kSigning = hmacSha256(kService, 'aws4_request')
  const signature = toHex(hmacSha256(kSigning, stringToSign))

  const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`
  const result: Record<string, string> = { authorization, 'x-amz-date': amzDate }
  if (securityToken) result['x-amz-security-token'] = securityToken
  return { headers: result }
}
