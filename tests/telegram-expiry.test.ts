import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../supabase/functions/telegram-publisher/index.ts', import.meta.url), 'utf8').replace(/^import .*\n/, '')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
async function run(delivered: unknown[], replies: { status?: number; description?: string }[] = [], attachments: unknown[] = []) {
  const calls: { method: string; body: any }[] = [], checkpoints: any[] = [], failures: any[] = [], removals: any[] = []
  const job = { id: 'job', lease_token: 'lease', revision: 2, payload: { expired: true, title: '', body: '', author: null, attachments }, delivered_parts: delivered, message_ids: [] }
  const db = { rpc: async (name: string, args: any) => name === 'claim_telegram_delivery' ? { data: [job] } : (checkpoints.push(args), {}),
    from: () => ({ update: (value: any) => { failures.push(value); return { eq: () => ({ eq: async () => ({}) }) } } }),
    storage: { from: () => ({ remove: async (paths: string[]) => { removals.push(paths); return {} } }) } }
  let handler: (req: Request) => Promise<Response> = async () => new Response('uninitialized')
  vm.runInNewContext(compiled, { createClient: () => db, Deno: { env: { get: (name: string) => name === 'TELEGRAM_DISPATCH_SECRET' ? 'secret' : name === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'configured' }, serve: (fn: typeof handler) => { handler = fn } },
    Request, Response, FormData, URL, AbortSignal, fetch: async (url: string, options: any) => {
      calls.push({ method: url.split('/').at(-1)!, body: JSON.parse(options.body) })
      const reply = replies.shift() || {}
      return new Response(JSON.stringify(reply.status ? { ok: false, error_code: reply.status, description: reply.description } : { ok: true, result: true }), { status: reply.status || 200 })
    } })
  const response = await handler(new Request('https://worker', { method: 'POST', headers: { 'x-dispatch-secret': 'secret' } }))
  return { response, calls, checkpoints, failures, removals }
}
const text = { key: 'text:0', kind: 'text', text: 'Объявление', messageId: 7 }
test('expiry deletes a message and checkpoints remaining attachment IDs', async () => {
  const result = await run([text, { key: 'file:0', kind: 'document', messageId: 8 }])
  assert.equal(result.calls[0].method, 'deleteMessage')
  assert.equal(result.calls[0].body.message_id, 7)
  assert.equal(result.checkpoints[0].parts[0].messageId, 8)
  assert.equal(result.checkpoints[0].complete, false)
})
test('old text is marked expired without sending a replacement', async () => {
  const result = await run([text], [{ status: 400, description: "Bad Request: message can't be deleted" }])
  assert.deepEqual(result.calls.map(c => c.method), ['deleteMessage', 'editMessageText'])
  assert.match(result.calls[1].body.text, /Срок истёк.*\n\nОбъявление/)
  assert.equal(result.checkpoints[0].parts.length, 0)
})
for (const kind of ['photo', 'document']) test(`old ${kind} has its caption marked expired`, async () => {
  const result = await run([{ key: 'file:0', kind, caption: 'Файл #Предмет', messageId: 8 }], [{ status: 400, description: "Bad Request: message can't be deleted" }])
  assert.deepEqual(result.calls.map(c => c.method), ['deleteMessage', 'editMessageCaption'])
  assert.match(result.calls[1].body.caption, /Срок истёк.*\n\nФайл #Предмет/)
})
test('missing Telegram messages are treated as removed', async () => {
  const result = await run([text], [{ status: 400, description: 'Bad Request: message to delete not found' }])
  assert.equal(result.checkpoints[0].parts.length, 0)
  assert.equal(result.calls.length, 1)
})
test('Telegram failure retains IDs for retry and does not remove files', async () => {
  const result = await run([text], [{ status: 429, description: 'Too Many Requests' }], [{ storage_path: 'keep.pdf' }])
  assert.equal(result.response.status, 503)
  assert.equal(result.checkpoints.length, 0)
  assert.equal(result.removals.length, 0)
  assert.equal(result.failures[0].last_error, 'telegram_429')
})
test('storage cleanup happens only after every Telegram message was processed', async () => {
  const result = await run([], [], [{ storage_path: 'owned.pdf' }, { url: 'https://external/file' }])
  assert.deepEqual(Array.from(result.removals[0]), ['owned.pdf'])
  assert.equal(result.checkpoints[0].complete, true)
  assert.equal(result.calls.length, 0)
})
