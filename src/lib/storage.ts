import { createClient } from '@supabase/supabase-js'
import type { Attachment, HubData, Material, Section, Subject } from './types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const supabase = url && key ? createClient(url, key) : null
export const isLocal = !supabase
const snapshotKey = supabase ? `cloud:${url}` : 'local-v2'
export const MAX_FILE_SIZE = 10 * 1024 * 1024

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('group-hub', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('values') }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Не удалось открыть локальное хранилище браузера.'))
  })
}
async function localRead<T>(key: string): Promise<T | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('values', 'readonly')
    const request = transaction.objectStore('values').get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => db.close()
  })
}
async function localWrite(key: string, value: unknown): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('values', 'readwrite')
    if (value === undefined) transaction.objectStore('values').delete(key)
    else transaction.objectStore('values').put(value, key)
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onerror = () => { db.close(); reject(new Error('Не удалось сохранить данные. Возможно, хранилище браузера заполнено.')) }
    transaction.onabort = () => { db.close(); reject(new Error('Сохранение отменено браузером.')) }
  })
}
async function readLocalData(): Promise<HubData> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('values', 'readwrite')
    const values = tx.objectStore('values')
    let data: HubData
    const request = values.get(snapshotKey)
    request.onsuccess = () => {
      if (request.result) { data = request.result; return }
      data = { subjects: [], sections: [], materials: [] }
      // The old version contained examples and subjects. Start the new space empty.
      const cursor = values.openCursor()
      cursor.onsuccess = () => {
        const entry = cursor.result
        if (!entry) { values.put(data, snapshotKey); return }
        const key = String(entry.key)
        if (key === 'demo-v1' || key.startsWith('file:')) entry.delete()
        entry.continue()
      }
    }
    tx.oncomplete = () => { db.close(); resolve(data) }
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Не удалось открыть локальные материалы.')) }
  })
}

export async function readData(): Promise<{ data: HubData; cached: boolean }> {
  if (!supabase) return { data: await readLocalData(), cached: false }
  try {
    const results = await Promise.all([
      supabase.from('subjects').select('*').order('name'),
      supabase.from('sections').select('*').order('position'),
      supabase.from('materials').select('*').order('created_at', { ascending: false }),
    ])
    for (const result of results) if (result.error) throw result.error
    const data: HubData = { subjects: results[0].data as Subject[], sections: results[1].data as Section[], materials: results[2].data as Material[] }
    try { await localWrite(snapshotKey, data) } catch { /* Online data remains usable if caching is unavailable. */ }
    return { data, cached: false }
  } catch {
    const cached = await localRead<HubData>(snapshotKey)
    if (cached) return { data: cached, cached: true }
    throw new Error('Не удалось загрузить материалы. Проверьте интернет и настройку базы Supabase.')
  }
}
export async function persistLocal(data: HubData): Promise<void> { await localWrite(snapshotKey, data) }
export async function saveMaterial(material: Material): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('materials').upsert(material).select('id').single()
  if (error) throw new Error('Не удалось сохранить блок. Проверьте подключение и настройку базы данных.')
}
export async function deleteMaterial(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('materials').delete().eq('id', id).select('id').single()
  if (error) throw new Error('Не удалось удалить блок.')
}
export async function addSubject(subject: Subject, sections: Section[]): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.rpc('create_subject', { subject_id: subject.id, subject_name: subject.name, subject_teacher: subject.teacher, subject_semester: subject.semester, subject_color: subject.color, section_names: sections.map(s => s.name), section_ids: sections.map(s => s.id) })
  if (error) throw new Error('Не удалось создать предмет. Проверьте подключение и установку SQL-схемы.')
}
export async function saveSection(section: Section): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('sections').upsert(section).select('id').single()
  if (error) throw new Error('Не удалось сохранить раздел.')
}
export async function uploadFile(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE_SIZE) throw new Error(`Файл «${file.name}» больше 10 МБ. Добавьте его ссылкой на облако.`)
  const id = crypto.randomUUID()
  if (!supabase) {
    await localWrite(`file:${id}`, file)
    return { id, name: file.name, url: `local-file:${id}`, size: file.size, storage_path: `local:${id}` }
  }
  const extension = file.name.includes('.') ? file.name.split('.').pop()!.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() : 'bin'
  const path = `${id}.${extension}`
  const { error } = await supabase.storage.from('materials').upload(path, file, { upsert: false })
  if (error) throw new Error(`Не удалось загрузить «${file.name}». Проверьте тип файла, доступное место и настройку хранилища.`)
  return { id, name: file.name, url: supabase.storage.from('materials').getPublicUrl(path).data.publicUrl, size: file.size, storage_path: path }
}
export async function removeFiles(attachments: Attachment[]): Promise<void> {
  const paths = attachments.filter(a => a.storage_path).map(a => a.storage_path!)
  if (!supabase) { await Promise.all(paths.filter(p => p.startsWith('local:')).map(p => localWrite(`file:${p.slice(6)}`, undefined))); return }
  if (!paths.length) return
  const { error } = await supabase.storage.from('materials').remove(paths)
  if (error) throw new Error('Блок сохранён, но старые файлы не удалось удалить из хранилища.')
}
export async function localFileUrl(id: string): Promise<string | null> {
  const blob = await localRead<Blob>(`file:${id}`)
  return blob ? URL.createObjectURL(blob) : null
}
