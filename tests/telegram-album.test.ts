import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const source = readFileSync(new URL('../supabase/functions/telegram-publisher/index.ts',import.meta.url),'utf8').replace(/^import .*\n/,'')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
const photo=(i:number)=>({name:`image-${i}.jpg`,url:`https://test.supabase.co/storage/v1/object/public/materials/image-${i}.jpg`,size:100,mime_type:'image/jpeg'})
async function run(count:number, delivered:any[]=[], fail=false, mixed=false) {
  const calls:{method:string;body:any}[]=[], checkpoints:any[]=[], failures:any[]=[]
  const job={id:'job',lease_token:'lease',revision:1,payload:{title:'Задание',body:'Описание',author:null,subject_name:'Математика',attachments:Array.from({length:count},(_,i)=>mixed && i===0 ? {...photo(i),name:'image.webp',mime_type:'image/webp'} : photo(i))},delivered_parts:delivered,message_ids:delivered.map(p=>p.messageId)}
  const db={rpc:async(name:string,args:any)=>name==='claim_telegram_delivery'?{data:[job]}:(checkpoints.push(args),{}),from:()=>({update:(value:any)=>{failures.push(value);return{eq:()=>({eq:async()=>({})})}}})}
  let handler:any
  vm.runInNewContext(compiled,{createClient:()=>db,Deno:{env:{get:(name:string)=>name==='SUPABASE_URL'?'https://test.supabase.co':'configured'},serve:(fn:any)=>{handler=fn}},Request,Response,FormData,URL,AbortSignal,fetch:async(url:string,options:any)=>{
    if(!url.startsWith('https://api.telegram.org/')) return new Response(new Blob(['image'],{type:'image/jpeg'}))
    const method=url.split('/').at(-1)!, body=options.body instanceof FormData?Object.fromEntries(options.body):JSON.parse(options.body)
    calls.push({method,body})
    if(fail) return new Response(JSON.stringify({ok:false,error_code:429,description:'Too Many Requests'}),{status:429})
    const result=method==='sendMediaGroup'?JSON.parse(body.media).map((_:unknown,i:number)=>({message_id:100+i,photo:[{}]})):{message_id:200,photo:[{}]}
    return Response.json({ok:true,result})
  }})
  const response=await handler(new Request('https://worker',{method:'POST',headers:{'x-dispatch-secret':'configured'}}))
  return{calls,checkpoints,failures,response}
}
test('multiple photos are sent in one album with all IDs checkpointed',async()=>{
  const result=await run(3)
  assert.deepEqual(result.calls.map(c=>c.method),['sendMediaGroup'])
  const media=JSON.parse(result.calls[0].body.media)
  assert.equal(media.length,3);assert.match(media[0].caption,/Описание/);assert.match(media[0].caption,/#Математика/)
  assert.equal(media[1].caption,'');assert.equal(media[2].caption,'')
  assert.deepEqual(Array.from(result.checkpoints[0].parts,(part:any)=>part.messageId),[100,101,102])
  assert.equal(result.checkpoints[0].complete,true)
})
test('Telegram album limit is respected and remaining photo stays queued',async()=>{
  const result=await run(11)
  assert.equal(JSON.parse(result.calls[0].body.media).length,10)
  assert.equal(result.checkpoints[0].parts.length,10);assert.equal(result.checkpoints[0].complete,false)
  const next=await run(11,result.checkpoints[0].parts)
  assert.deepEqual(next.calls.map(c=>c.method),['sendPhoto'])
  assert.equal(next.checkpoints[0].parts.length,11);assert.equal(next.checkpoints[0].complete,true)
})
test('editing an album preserves its existing Telegram IDs',async()=>{
  const initial=await run(2), delivered=initial.checkpoints[0].parts
  delivered[0].caption='Старое описание'
  const result=await run(2,delivered)
  assert.deepEqual(result.calls.map(c=>c.method),['editMessageMedia'])
  assert.equal(result.checkpoints[0].parts.find((p:any)=>p.key==='file:0').messageId,100)
  assert.equal(result.checkpoints[0].complete,true)
})
test('failed album is retried without discarding confirmed messages',async()=>{
  const result=await run(2,[],true)
  assert.equal(result.response.status,503);assert.equal(result.checkpoints.length,0)
  assert.equal(result.failures[0].last_error,'telegram_429')
})

test('mixed image formats stay together as original files in a document album',async()=>{
  const result=await run(2,[],false,true)
  assert.deepEqual(result.calls.map(c=>c.method),['sendMediaGroup'])
  assert.deepEqual(JSON.parse(result.calls[0].body.media).map((part:any)=>part.type),['document','document'])
  assert.equal(result.checkpoints[0].complete,true)
})
