/**
 * Local SQLite store (spec §9). Library, reading progress, highlights, bookmarks.
 * Everything stays on-device.
 */
import * as SQLite from 'expo-sqlite';

export type DocFormat =
  | 'pdf'
  | 'epub'
  | 'doc'
  | 'docx'
  | 'txt'
  | 'md'
  | 'json'
  | 'csv'
  | 'html';
export type ReadStatus = 'unread' | 'reading' | 'finished';

export type DocumentRow = {
  id: string;
  title: string;
  author: string | null;
  format: DocFormat;
  file_uri: string;
  size_bytes: number;
  thumbnail_uri: string | null;
  added_at: number;
  last_opened_at: number | null;
  progress: number; // 0..1
  location: string | null; // CFI (epub) or page+offset (pdf)
  is_favorite: number; // 0|1
  read_status: ReadStatus;
};

export type HighlightRow = {
  id: string;
  document_id: string;
  color: string;
  anchor: string; // CFI (epub) or JSON {page, rects[]} (pdf)
  text_excerpt: string;
  created_at: number;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb() {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync('revpdf.db');
  return dbPromise;
}

export async function initDatabase() {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      format TEXT NOT NULL,
      file_uri TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      thumbnail_uri TEXT,
      added_at INTEGER NOT NULL,
      last_opened_at INTEGER,
      progress REAL NOT NULL DEFAULT 0,
      location TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      read_status TEXT NOT NULL DEFAULT 'unread'
    );
    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL,
      color TEXT NOT NULL,
      anchor TEXT NOT NULL,
      text_excerpt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL,
      location TEXT NOT NULL,
      label TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
  `);
}

// ---------- documents ----------

export async function listDocuments(): Promise<DocumentRow[]> {
  const db = await getDb();
  return db.getAllAsync<DocumentRow>(
    `SELECT * FROM documents ORDER BY COALESCE(last_opened_at, added_at) DESC`,
  );
}

export async function getDocument(id: string): Promise<DocumentRow | null> {
  const db = await getDb();
  return db.getFirstAsync<DocumentRow>(`SELECT * FROM documents WHERE id = ?`, id);
}

export async function insertDocument(
  doc: Omit<
    DocumentRow,
    'added_at' | 'last_opened_at' | 'progress' | 'is_favorite' | 'read_status' | 'location'
  >,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO documents
      (id, title, author, format, file_uri, size_bytes, thumbnail_uri, added_at, progress, is_favorite, read_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'unread')`,
    doc.id,
    doc.title,
    doc.author,
    doc.format,
    doc.file_uri,
    doc.size_bytes,
    doc.thumbnail_uri,
    Date.now(),
  );
}

export async function updateProgress(
  id: string,
  progress: number,
  location: string | null,
): Promise<void> {
  const db = await getDb();
  const status: ReadStatus = progress >= 0.999 ? 'finished' : progress > 0 ? 'reading' : 'unread';
  await db.runAsync(
    `UPDATE documents SET progress = ?, location = ?, last_opened_at = ?, read_status = ? WHERE id = ?`,
    progress,
    location,
    Date.now(),
    status,
    id,
  );
}

export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE documents SET is_favorite = ? WHERE id = ?`, favorite ? 1 : 0, id);
}

export async function setThumbnail(id: string, uri: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE documents SET thumbnail_uri = ? WHERE id = ?`, uri, id);
}

export async function renameDocument(id: string, title: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE documents SET title = ? WHERE id = ?`, title, id);
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM documents WHERE id = ?`, id);
}

// ---------- highlights ----------

export async function listHighlights(documentId: string): Promise<HighlightRow[]> {
  const db = await getDb();
  return db.getAllAsync<HighlightRow>(
    `SELECT * FROM highlights WHERE document_id = ? ORDER BY created_at DESC`,
    documentId,
  );
}

export async function addHighlight(h: HighlightRow): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO highlights (id, document_id, color, anchor, text_excerpt, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    h.id,
    h.document_id,
    h.color,
    h.anchor,
    h.text_excerpt,
    h.created_at,
  );
}

export async function updateHighlightColor(id: string, color: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE highlights SET color = ? WHERE id = ?`, color, id);
}

export async function deleteHighlight(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM highlights WHERE id = ?`, id);
}
