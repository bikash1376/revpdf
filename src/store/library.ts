/**
 * Library state + local file import. Files are copied into the app's document
 * directory so revpdf owns a stable local copy (no reliance on external URIs).
 */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as LegacyFS from 'expo-file-system/legacy';
import { create } from 'zustand';

import {
  deleteDocument as dbDelete,
  insertDocument,
  listDocuments,
  setFavorite as dbSetFavorite,
  type DocFormat,
  type DocumentRow,
} from '@/db';

const SUPPORTED: Record<string, DocFormat> = {
  pdf: 'pdf',
  epub: 'epub',
  doc: 'doc',
  docx: 'docx',
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
  json: 'json',
  csv: 'csv',
  html: 'html',
  htm: 'html',
};

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatFromName(name: string): DocFormat | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED[ext] ?? null;
}

function titleFromName(name: string) {
  return name.replace(/\.[^.]+$/, '');
}

type LibraryState = {
  documents: DocumentRow[];
  loading: boolean;
  importing: boolean;
  refresh: () => Promise<void>;
  importFiles: () => Promise<number>;
  remove: (id: string) => Promise<void>;
  toggleFavorite: (id: string, value: boolean) => Promise<void>;
};

export const useLibrary = create<LibraryState>((set, get) => ({
  documents: [],
  loading: false,
  importing: false,

  refresh: async () => {
    set({ loading: true });
    try {
      set({ documents: await listDocuments() });
    } finally {
      set({ loading: false });
    }
  },

  importFiles: async () => {
    set({ importing: true });
    try {
      const res = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
        // Broad: some sources report EPUB/MD/etc. as octet-stream, so we accept
        // anything and filter by extension in formatFromName().
        type: '*/*',
      });
      if (res.canceled) return 0;

      const booksDir = new Directory(Paths.document, 'books');
      if (!booksDir.exists) booksDir.create({ intermediates: true });

      let added = 0;
      for (const asset of res.assets) {
        const format = formatFromName(asset.name);
        if (!format) continue;

        const id = makeId();
        const dest = new File(booksDir, `${id}.${format}`);
        try {
          if (dest.exists) dest.delete();
          // Legacy copyAsync reliably handles content:// and file:// sources
          // (the new File().copy() can silently produce an empty file for some).
          await LegacyFS.copyAsync({ from: asset.uri, to: dest.uri });
        } catch {
          continue;
        }

        // Verify the copy actually has content; skip empty/failed copies.
        const info = await LegacyFS.getInfoAsync(dest.uri);
        if (!info.exists || !info.size) {
          try {
            dest.delete();
          } catch {
            /* ignore */
          }
          continue;
        }

        await insertDocument({
          id,
          title: titleFromName(asset.name),
          author: null,
          format,
          file_uri: dest.uri,
          size_bytes: info.size,
          thumbnail_uri: null,
        });
        added += 1;
      }

      if (added > 0) await get().refresh();
      return added;
    } finally {
      set({ importing: false });
    }
  },

  remove: async (id) => {
    const doc = get().documents.find((d) => d.id === id);
    if (doc) {
      try {
        const f = new File(doc.file_uri);
        if (f.exists) f.delete();
      } catch {
        // ignore — DB row removal is the source of truth
      }
    }
    await dbDelete(id);
    await get().refresh();
  },

  toggleFavorite: async (id, value) => {
    await dbSetFavorite(id, value);
    set((s) => ({
      documents: s.documents.map((d) => (d.id === id ? { ...d, is_favorite: value ? 1 : 0 } : d)),
    }));
  },
}));
