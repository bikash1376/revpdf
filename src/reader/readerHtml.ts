/**
 * Loads the bundled, self-contained reader.html (vendored epub.js + jszip +
 * controller) as a string for use as WebView `source`. Cached after first read.
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const READER_HTML_MODULE = require('@/assets/reader/reader.html');

let cached: string | null = null;

export async function loadReaderHtml(): Promise<string> {
  if (cached) return cached;
  const asset = Asset.fromModule(READER_HTML_MODULE);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  cached = await new File(uri).text();
  return cached;
}
