export interface Subject { id: string; name: string; teacher: string; semester: number; color: string; position: number }
export interface Section { id: string; subject_id: string; name: string; position: number }
export interface Attachment { id: string; name: string; url: string; size?: number; storage_path?: string; mime_type?: string }
export const AUTHORS = ['Староста', 'Групп.орг', 'Проф.орг'] as const
export type Author = typeof AUTHORS[number]
export interface Material {
  id: string; subject_id: string | null; section_id: string | null; title: string;
  body: string; deadline: string | null; pinned: boolean; author: Author | null; created_at: string; attachments: Attachment[]
}
export interface HubData { subjects: Subject[]; sections: Section[]; materials: Material[] }
export type Page = 'home' | 'subjects' | 'subject' | 'recent' | 'deadlines'
