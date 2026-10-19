import { createClient } from 'npm:@supabase/supabase-js@2'
import { ApplicationServer, generateVapidKeys, exportVapidKeys, importVapidKeys, exportApplicationServerKey, PushMessageError } from 'jsr:@negrel/webpush@0.5.0'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const origins = new Set(['https://sagatovae.github.io', 'http://127.0.0.1:5173', 'http://localhost:5173'])
function headers(origin: string) {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'content-type, apikey, authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' }
}
function endpointAllowed(endpoint: string) {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (['fcm.googleapis.com','android.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname) || url.hostname.endsWith('.notify.windows.com'))
  } catch { return false }
}
function validKey(value: unknown, bytes: number) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false
  try { return atob(value.replace(/-/g,'+').replace(/_/g,'/')).length === bytes } catch { return false }
}
async function server() {
  let result = await db.from('push_config').select('keys').eq('id', true).maybeSingle()
  if (result.error) throw new Error('config_unavailable')
  if (!result.data) {
    const generated = await exportVapidKeys(await generateVapidKeys({ extractable: true }))
    const saved = await db.from('push_config').upsert({ id: true, keys: generated }, { onConflict: 'id', ignoreDuplicates: true })
    if (saved.error) throw new Error('config_unavailable')
    result = await db.from('push_config').select('keys').eq('id', true).single()
    if (result.error) throw new Error('config_unavailable')
  }
  const vapidKeys = await importVapidKeys(result.data!.keys)
  return { vapidKeys, app: await ApplicationServer.new({ contactInformation: 'https://github.com/Sagatovae/group-hub', vapidKeys }) }
}

Deno.serve(async request => {
  const dispatchSecret = Deno.env.get('TELEGRAM_DISPATCH_SECRET')
  const dispatch = !!dispatchSecret && request.headers.get('x-dispatch-secret') === dispatchSecret
  if (dispatch) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    try {
      const { app } = await server()
      const jobs = await db.rpc('claim_push_deliveries')
      if (jobs.error) return new Response('Queue unavailable', { status: 503 })
      await Promise.all((jobs.data || []).map(async (job: { id: string; subscription_id: string; lease_token: string; material_id: string; payload: unknown; attempts: number }) => {
        const subscription = await db.from('push_subscriptions').select('subscription').eq('id', job.subscription_id).maybeSingle()
        if (subscription.error) return
        if (!subscription.data) return
        try {
          if (!endpointAllowed(subscription.data.subscription.endpoint)) throw new Error('invalid_endpoint')
          await app.subscribe(subscription.data.subscription).pushTextMessage(JSON.stringify(job.payload), { ttl: 86400, topic: job.material_id.replace(/-/g,'') })
          await db.from('push_deliveries').update({ sent_at: new Date().toISOString(), lease_until: null, last_error: null }).eq('id',job.id).eq('lease_token',job.lease_token)
        } catch (error) {
          if (error instanceof PushMessageError && [404,410].includes(error.response.status)) {
            await db.from('push_subscriptions').delete().eq('id', job.subscription_id)
          } else {
            await db.from('push_deliveries').update({ last_error: 'push_delivery_failed', lease_until: null,
              available_at: new Date(Date.now() + Math.min(3600, 60 * 2 ** job.attempts) * 1000).toISOString(),
            }).eq('id',job.id).eq('lease_token',job.lease_token)
          }
        }
      }))
      // Old notifications are no longer useful and should not accumulate indefinitely.
      await db.from('push_deliveries').delete().lt('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
      return new Response('Processed')
    } catch { return new Response('Push unavailable', { status: 503 }) }
  }
  const origin = request.headers.get('origin') || ''
  if (!origins.has(origin)) return new Response('Origin not allowed', { status: 403 })
  const cors = headers(origin)
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
  try {
    if (request.method === 'GET') {
      const { vapidKeys } = await server()
      return Response.json({ publicKey: await exportApplicationServerKey(vapidKeys) }, { headers: { ...cors, 'Cache-Control': 'no-store' } })
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors })
    if (!request.headers.get('content-type')?.includes('application/json')) return new Response('JSON required', { status: 415, headers: cors })
    const raw = await request.text()
    if (raw.length > 8192) return new Response('Too large', { status: 413, headers: cors })
    const input = JSON.parse(raw)
    const sub = input.subscription
    if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 4096 || !endpointAllowed(sub.endpoint)) return new Response('Invalid subscription', { status: 400, headers: cors })
    if (input.action === 'unsubscribe') {
      const result = await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      if (result.error) throw result.error
    } else if (input.action === 'subscribe' && validKey(sub.keys?.p256dh,65) && validKey(sub.keys?.auth,16)) {
      const result = await db.from('push_subscriptions').upsert({ endpoint: sub.endpoint,
        subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' })
      if (result.error) throw result.error
    } else return new Response('Invalid subscription', { status: 400, headers: cors })
    return Response.json({ ok: true }, { headers: cors })
  } catch { return new Response('Unable to save notification settings', { status: 503, headers: cors }) }
})
