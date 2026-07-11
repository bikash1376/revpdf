import { File, Paths, Directory } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { insertDocument } from '@/db';
import { cmd, parseOutbound } from '@/reader/bridge';
import { loadReaderHtml } from '@/reader/readerHtml';

export type ConvertProgress = { progress: number; stage: string };

type Props = {
  /** The PDF to convert. Null parks the converter without doing anything. */
  source: { uri: string; title: string } | null;
  onProgress: (p: ConvertProgress) => void;
  /** Fires with the new library row id once the EPUB is on disk and in the DB. */
  onDone: (documentId: string) => void;
  onError: (message: string) => void;
};

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Headless converter: an off-screen WebView that reuses the reader's own engine
 * (pdf.js to read the text, JSZip to write the EPUB) so the conversion runs
 * fully on-device with no extra dependency and no network.
 */
export function PdfToEpubConverter({ source, onProgress, onDone, onError }: Props) {
  const webRef = useRef<WebView>(null);
  const [html, setHtml] = useState<string | null>(null);
  // The engine posts `ready` once; the conversion can only start after that, but
  // `source` may well arrive first — so we track both and fire when they meet.
  const engineReady = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    loadReaderHtml().then(setHtml).catch(() => onError('Could not load the converter.'));
  }, [onError]);

  const start = async () => {
    if (!source || started.current || !engineReady.current) return;
    started.current = true;
    try {
      const base64 = await new File(source.uri).base64();
      webRef.current?.injectJavaScript(cmd.convertPdfToEpub(base64, source.title));
    } catch {
      onError('Could not read the PDF file.');
    }
  };

  useEffect(() => {
    if (source) start();
    else started.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const save = async (base64: string) => {
    if (!source) return;
    try {
      const booksDir = new Directory(Paths.document, 'books');
      if (!booksDir.exists) booksDir.create({ intermediates: true });
      const id = makeId();
      const dest = new File(booksDir, `${id}.epub`);
      if (dest.exists) dest.delete();
      dest.create();
      dest.write(Uint8Array.from(atob(base64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

      await insertDocument({
        id,
        title: source.title,
        author: null,
        format: 'epub',
        file_uri: dest.uri,
        size_bytes: dest.size ?? 0,
        thumbnail_uri: null,
      });
      onDone(id);
    } catch {
      onError('Could not save the converted EPUB.');
    }
  };

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = parseOutbound(e.nativeEvent.data);
    if (!msg) return;
    if (msg.type === 'ready') {
      engineReady.current = true;
      start();
      return;
    }
    if (msg.type === 'convertProgress') onProgress({ progress: msg.progress, stage: msg.stage });
    if (msg.type === 'converted') save(msg.base64);
    if (msg.type === 'error') onError(msg.message);
  };

  if (!html || !source) return null;

  return (
    // Off-screen rather than display:none — a zero-size WebView can get its JS
    // context throttled or torn down on Android, which would stall the convert.
    <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0, left: -10 }}>
      <WebView
        ref={webRef}
        originWhitelist={['https://revpdf.local', 'blob:', 'data:', 'about:']}
        source={{ html, baseUrl: 'https://revpdf.local/' }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
      />
    </View>
  );
}
