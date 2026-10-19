import test from 'node:test'
import assert from 'node:assert/strict'
import { matchesQuery, safeUrl, sortMaterials, upcomingDeadlines, moveSubject, normalizeData, isImageAttachment } from '../src/lib/utils.ts'
import type { Material } from '../src/lib/types.ts'

const material = (overrides: Partial<Material>): Material => ({
  id: '1', subject_id: null, section_id: null, title: 'Лабораторная', body: '',
  pinned: false, deadline: null, created_at: '2026-10-19T10:00:00Z', attachments: [], author: null, ...overrides,
})

test('external attachments reject executable URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>hi</script>', 'file:///etc/passwd', '//evil.example', 'not a link']) assert.equal(safeUrl(url), null)
  assert.equal(safeUrl('https://drive.google.com/file/d/example'), 'https://drive.google.com/file/d/example')
})
test('deadlines include today, exclude overdue and sort by calendar date', () => {
  const today = new Date(2026, 9, 19, 23, 59)
  const result = upcomingDeadlines([material({ id:'future', deadline:'2026-10-22' }), material({id:'old',deadline:'2026-10-18'}), material({id:'today',deadline:'2026-10-19'}), material({id:'none'})], today)
  assert.deepEqual(result.map(m=>m.id), ['today','future'])
})
test('pinned announcements stay first without mutating input', () => {
  const rows = [material({id:'recent'}), material({id:'pin', pinned:true, created_at:'2026-01-01T00:00:00Z'})]
  assert.deepEqual(sortMaterials(rows).map(m=>m.id), ['pin','recent'])
  assert.equal(rows[0].id, 'recent')
})
test('search finds Russian text and attachment names regardless of case', () => {
  const row = material({attachments:[{id:'f',name:'Шаблон отчёта.pdf',url:'https://example.com/file.pdf'}]})
  assert.equal(matchesQuery(row,' ШАБЛОН '), true)
  assert.equal(matchesQuery(row,'лабораторная'), true)
  assert.equal(matchesQuery(row,'несуществующий'), false)
})

const subject = (id: string, position: number) => ({id,position,name:id,teacher:'',semester:1,color:'sage'})
test('reordering preserves subject data and skips filtered items', () => {
  const original=[subject('a',0),subject('b',1),subject('c',2)]
  const moved=moveSubject(original,'c',-1,['a','c'])
  assert.deepEqual(moved.map(s=>s.id),['c','b','a'])
  assert.deepEqual(moved.map(s=>s.position),[0,1,2])
  assert.deepEqual(original.map(s=>s.id),['a','b','c'])
  assert.equal(moveSubject(original,'a',-1),original)
})
test('shared order and author survive reading older cached content', () => {
  const result=normalizeData({subjects:[subject('a',2),subject('b',1)],sections:[],materials:[material({author:'Староста'})]})
  assert.deepEqual(result.subjects.map(s=>s.id),['b','a'])
  assert.equal(matchesQuery(result.materials[0],'староста'),true)
})
test('image previews recognize raster uploads without rendering SVG as images', () => {
  assert.equal(isImageAttachment({id:'a',name:'Фото.JPG',url:'https://example.com/a'}),true)
  assert.equal(isImageAttachment({id:'a',name:'Фото',url:'https://example.com/a',mime_type:'image/webp'}),true)
  assert.equal(isImageAttachment({id:'a',name:'file.svg',url:'https://example.com/a',mime_type:'image/svg+xml'}),false)
})
