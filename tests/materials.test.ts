import test from 'node:test'
import assert from 'node:assert/strict'
import { matchesQuery, safeUrl, sortMaterials, upcomingDeadlines } from '../src/lib/utils.ts'
import type { Material } from '../src/lib/types.ts'

const material = (overrides: Partial<Material>): Material => ({
  id: '1', subject_id: null, section_id: null, title: 'Лабораторная', body: '',
  pinned: false, deadline: null, created_at: '2026-10-19T10:00:00Z', attachments: [], ...overrides,
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
