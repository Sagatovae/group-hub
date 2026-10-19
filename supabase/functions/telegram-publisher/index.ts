import { createClient } from 'npm:@supabase/supabase-js@2'

type Attachment = { name: string; url: string; size?: number; mime_type?: string }
type Material = { title: string; body: string; author: string | null; attachments: Attachment[] }
type Part = { text: string } | { file: Attachment }

function parts(material: Material): Part[] {
  const text = [material.title, material.body, material.author].filter(Boolean).join('\n\n')
  const result: Part[] = []
  // Leave room below Telegram's 4096-character limit; split by Unicode code points.
  const characters = Array.from(text)
  for (let i = 0; i < characters.length; i += 1800) result.push({ text: characters.slice(i, i + 1800).join('') })
  for (const file of material.attachments || []) result.push({ file })
  return result
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
  const update = async (values: Record<string, unknown>) => {
    const result = await db.from('telegram_outbox').update(values).eq('id', job.id).eq('lease_token', job.lease_token).select('id').single()
    if (result.error) throw new DeliveryError('queue_checkpoint_failed', 180)
  }
  const api = async (method: string, body: FormData | Record<string, unknown>) => {
    let response: Response
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body),
        headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25000),
      })
    } catch { throw new DeliveryError('telegram_network_error', 180) }
    const value = await response.json().catch(() => null)
    if (!response.ok || !value?.ok) throw new DeliveryError(`telegram_${value?.error_code || response.status}`, Math.max(60, value?.parameters?.retry_after || 0))
    return value.result.message_id as number
  }
  try {
    const items = parts(job.payload)
    // One Telegram request per invocation avoids flooding the channel.
    const part = items[job.next_part]
    if (!part) { await update({ sent_at: new Date().toISOString(), lease_until: null }); return new Response('Delivered') }
    let messageId: number
    if ('text' in part) {
      messageId = await api('sendMessage', { chat_id: channel, text: part.text, link_preview_options: { is_disabled: true } })
    } else {
      const file = part.file
      const source = new URL(file.url)
      const storage = new URL(url)
      // Fetch only this project's public material bucket; never arbitrary visitor URLs.
      const stored = source.origin === storage.origin && source.pathname.startsWith('/storage/v1/object/public/materials/')
      if (!stored || (file.size || 0) > 10485760) {
        if (source.protocol !== 'https:' && source.protocol !== 'http:') throw new DeliveryError('unsupported_attachment_url')
        messageId = await api('sendMessage', { chat_id: channel, text: `${file.name.slice(0, 180)}\n${file.url.slice(0, 3500)}`, link_preview_options: { is_disabled: true } })
      } else {
        const response = await fetch(source, { signal: AbortSignal.timeout(15000), redirect: 'error' })
        if (!response.ok) throw new DeliveryError('attachment_unavailable')
        const blob = await response.blob()
        if (blob.size > 10485760) throw new DeliveryError('attachment_too_large')
        const photo = ['image/jpeg', 'image/png'].includes(file.mime_type || blob.type)
        const form = new FormData()
        form.set('chat_id', channel)
        form.set(photo ? 'photo' : 'document', blob, file.name)
        messageId = await api(photo ? 'sendPhoto' : 'sendDocument', form)
      }
    }
    const next = job.next_part + 1
    await update({ next_part: next, message_ids: [...job.message_ids, messageId], attempts: 0, last_error: null,
      sent_at: next === items.length ? new Date().toISOString() : null,
      available_at: new Date(Date.now() + 3000).toISOString(), lease_until: null })
    return new Response('Sent')
  } catch (error) {
    const failure = error instanceof DeliveryError ? error : new DeliveryError('delivery_failed')
    // Never put Telegram tokens, remote error bodies or signed URLs in logs.
    try { await update({ last_error: failure.code, available_at: new Date(Date.now() + failure.delay * 1000).toISOString(), lease_until: null }) } catch { /* Lease expiration allows recovery. */ }
    return new Response('Delivery postponed', { status: 503 })
  }
})
