import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const source=readFileSync(new URL('../supabase/functions/push-notifications/index.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
const subject='11111111-1111-4111-8111-111111111111'
async function run(muted:string[],route:string,subscribe=false) {
  let handler:any, pushes=0, saved:any
  const updates:any[]=[]
  const subscription={endpoint:'https://fcm.googleapis.com/example',keys:{p256dh:btoa('a'.repeat(65)),auth:btoa('b'.repeat(16))},preferences:{muted_subjects:muted}}
  const db={rpc:async()=>({data:[{id:'job',subscription_id:'sub',lease_token:'lease',material_id:subject,payload:{route}}]}),from:(table:string)=>({
    select:()=>({eq:()=>({maybeSingle:async()=>({data:table==='push_config'?{keys:{}}:{subscription}})})}),
    upsert:async(value:any)=>{saved=value;return{}},
    update:(value:any)=>{updates.push(value);return{eq:()=>({eq:async()=>({})})}},
    delete:()=>({lt:async()=>({}),eq:async()=>({})})
  })}
  vm.runInNewContext(compiled,{createClient:()=>db,Deno:{env:{get:()=> 'configured'},serve:(fn:any)=>{handler=fn}},Request,Response,URL,atob,
    importVapidKeys:async()=>({}),ApplicationServer:{new:async()=>({subscribe:()=>({pushTextMessage:async()=>{pushes++}})})},PushMessageError:class extends Error{}})
  const request=subscribe?new Request('https://worker',{method:'POST',headers:{origin:'https://sagatovae.github.io','content-type':'application/json'},body:JSON.stringify({action:'subscribe',subscription,preferences:{muted_subjects:muted}})}):new Request('https://worker',{method:'POST',headers:{'x-dispatch-secret':'configured'}})
  return{response:await handler(request),pushes,updates,saved}
}
test('muted subject never reaches the push provider',async()=>{
  const result=await run([subject],`#subject/${subject}`)
  assert.equal(result.response.status,200);assert.equal(result.pushes,0);assert.equal(result.updates[0].last_error,'muted_by_device')
})
test('muting a subject does not suppress group announcements',async()=>{
  const result=await run([subject],'#home')
  assert.equal(result.pushes,1)
})
test('announcements can be disabled independently',async()=>{
  assert.equal((await run(['announcements'],'#home')).pushes,0)
  assert.equal((await run(['announcements'],`#subject/${subject}`)).pushes,1)
})
test('preferences are saved with the device subscription',async()=>{
  const result=await run([subject],'#home',true)
  assert.equal(result.response.status,200)
  assert.deepEqual(Array.from(result.saved.subscription.preferences.muted_subjects),[subject])
})
