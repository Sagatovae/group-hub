import { createClient } from 'npm:@supabase/supabase-js@2'

type Attachment = { name: string; url: string; size?: number; mime_type?: string }
type Material = { title: string; body: string; author: string | null; attachments: Attachment[]; subject_name?: string | null; section_name?: string | null }
type Part = { key: string; kind: 'text' | 'photo' | 'document'; text?: string; file?: Attachment }
type Delivered = Part & { messageId: number }

function parts(material: Material, storageUrl: string): Part[] {
  const hashtag = material.subject_name
    ? '#' + material.subject_name.normalize('NFKC').replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 80)
    : material.subject_name === null ? '#Объявления' : ''
  const text = [material.title, material.section_name, material.body, material.author, hashtag].filter(Boolean).join('\n\n')
  const result: Part[] = []
  const characters = Array.from(text)
  for (let i = 0; i < characters.length; i += 1800) {
    result.push({ key: `text:${i / 1800}`, kind: 'text', text: characters.slice(i, i + 1800).join('') })
  }
  for (const [i, file] of (material.attachments || []).entries()) {
    const source = new URL(file.url)
    if (!['https:', 'http:'].includes(source.protocol)) throw new DeliveryError('unsupported_attachment_url')
    const stored = source.origin === new URL(storageUrl).origin && source.pathname.startsWith('/storage/v1/object/public/materials/')
    if (!stored || (file.size || 0) > 10485760) {
      result.push({ key: `file:${i}`, kind: 'text', text: `${file.name.slice(0, 180)}\n${file.url.slice(0, 3500)}` })
    } else {
      const photo = ['image/jpeg', 'image/png'].includes(file.mime_type || '') || (!file.mime_type && /\.(png|jpe?g)$/i.test(source.pathname))
      result.push({ key: `file:${i}`, kind: photo ? 'photo' : 'document', file })
    }
  }
  return result
}
function same(a: Part, b: Part) {
  return a.kind === b.kind && a.text === b.text &&
    a.file?.url === b.file?.url && a.file?.name === b.file?.name && a.file?.mime_type === b.file?.mime_type
}
function synchronized(wanted: Part[], delivered: Delivered[]) {
  return wanted.length === delivered.length && wanted.every(part => delivered.some(sent => sent.key === part.key && same(sent, part)))
}
class DeliveryError extends Error {
  constructor(public code: string, public delay = 60) { super(code) }
}

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const secret = Deno.env.get('TELEGRAM_DISPATCH_SECRET')
  if (!secret || request.headers.get('x-dispatch-secret') !== secret) return new Response('Unauthorized', { status: 401 })
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const channel = Deno.env.get('TELEGRAM_CHANNEL_ID')
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!token || !channel || !key) return new Response('Missing server configuration', { status: 503 })
  const db = createClient(url, key, { auth: { persistSession: false } })
  const claimed = await db.rpc('claim_telegram_delivery')
  if (claimed.error) return new Response('Queue unavailable', { status: 503 })
  const job = claimed.data?.[0]
  if (!job) return new Response('Queue empty')
  const api = async (method: string, body: FormData | Record<string, unknown>, existingId?: number): Promise<number> => {
    let response: Response
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body),
        headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25000),
      })
    } catch { throw new DeliveryError('telegram_network_error', 180) }
    const value = await response.json().catch(() => null)
    if (!response.ok || !value?.ok) {
      const description = String(value?.description || '')
      if (existingId && value?.error_code === 400) {
        if (method.startsWith('edit') && description.includes('message is not modified')) return existingId
        if (description.includes('message to edit not found') || description.includes('message to delete not found')) {
          if (method === 'deleteMessage') return existingId
          throw new DeliveryError('message_missing', 3)
        }
      }
      throw new DeliveryError(`telegram_${value?.error_code || response.status}`, Math.max(60, value?.parameters?.retry_after || 0))
    }
    return existingId || value.result.message_id
  }
  const checkpoint = async (delivered: Delivered[], complete: boolean) => {
    const result = await db.rpc('checkpoint_telegram_delivery', { job_id: job.id, token: job.lease_token,
      expected_revision: job.revision, parts: delivered, complete })
    if (result.error) throw new DeliveryError('queue_checkpoint_failed', 180)
  }
  try {
    const wanted = parts(job.payload, url)
    const legacy = job.delivered_parts == null ? parts(job.legacy_payload || job.payload, url) : []
    let delivered: Delivered[] = job.delivered_parts ?? legacy.slice(0, job.message_ids.length).map((part, i) => ({ ...part, messageId: job.message_ids[i] }))
    // One Telegram mutation per invocation; keep confirmed state for unchanged parts.
    const target = wanted.find(part => !delivered.some(sent => sent.key === part.key && same(sent, part)))
    const existing = target ? delivered.find(sent => sent.key === target.key) : delivered.find(sent => !wanted.some(part => part.key === sent.key))
    if (!target || (existing && (existing.kind === 'text') !== (target.kind === 'text'))) {
      if (existing) {
        await api('deleteMessage', { chat_id: channel, message_id: existing.messageId }, existing.messageId)
        delivered = delivered.filter(sent => sent.key !== existing.key)
      }
    } else {
      let messageId: number
      try {
        if (target.kind === 'text') {
          messageId = await api(existing ? 'editMessageText' : 'sendMessage', {
            chat_id: channel, ...(existing ? { message_id: existing.messageId } : {}),
            text: target.text, link_preview_options: { is_disabled: true },
          }, existing?.messageId)
        } else {
          const response = await fetch(target.file!.url, { signal: AbortSignal.timeout(15000), redirect: 'error' })
          if (!response.ok) throw new DeliveryError('attachment_unavailable')
          const blob = await response.blob()
          if (blob.size > 10485760) throw new DeliveryError('attachment_too_large')
          const form = new FormData()
          form.set('chat_id', channel)
          if (existing) {
            form.set('message_id', String(existing.messageId))
            form.set('media', JSON.stringify({ type: target.kind, media: 'attach://upload' }))
            form.set('upload', blob, target.file!.name)
          } else form.set(target.kind, blob, target.file!.name)
          messageId = await api(existing ? 'editMessageMedia' : target.kind === 'photo' ? 'sendPhoto' : 'sendDocument', form, existing?.messageId)
        }
        delivered = [...delivered.filter(sent => sent.key !== target.key), { ...target, messageId }]
      } catch (error) {
        if (error instanceof DeliveryError && error.code === 'message_missing' && existing) {
          delivered = delivered.filter(sent => sent.key !== existing.key)
        } else throw error
      }
    }
    await checkpoint(delivered, synchronized(wanted, delivered))
    return new Response('Synchronized')
  } catch (error) {
    const failure = error instanceof DeliveryError ? error : new DeliveryError('delivery_failed')
    // Do not log Telegram tokens, remote response bodies or signed URLs.
    await db.from('telegram_outbox').update({ last_error: failure.code,
      available_at: new Date(Date.now() + failure.delay * 1000).toISOString(), lease_until: null,
    }).eq('id', job.id).eq('lease_token', job.lease_token)
    return new Response('Delivery postponed', { status: 503 })
  }
})
