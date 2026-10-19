export interface Subject { id: string; name: string; teacher: string; semester: number; color: string }
export interface Section { id: string; subject_id: string; name: string; position: number }
export interface Attachment { id: string; name: string; url: string; size?: number; storage_path?: string }
export interface Material {
  id: string; subject_id: string | null; section_id: string | null; title: string;
  body: string; deadline: string | null; pinned: boolean; created_at: string; attachments: Attachment[]
}
export interface HubData { subjects: Subject[]; sections: Section[]; materials: Material[] }
export type Page = 'home' | 'subjects' | 'subject'
