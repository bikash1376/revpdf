/**
 * Global, locally-persisted settings (spec §8 + §7 reader display controls).
 * Everything revpdf remembers lives here. No network, no accounts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { ReaderThemeName, ReadingFontKey, ThemeName } from '../theme/tokens';

export type SearchEngine = 'google' | 'duckduckgo' | 'yandex' | 'yahoo' | 'disabled';
export type ReadingMode = 'paginated' | 'scroll';
export type TextAlign = 'justify' | 'left' | 'center' | 'right';
export type OpenLinksIn = 'in-app' | 'external';

export const SEARCH_ENGINES: Record<
  Exclude<SearchEngine, 'disabled'>,
  { label: string; url: (q: string) => string }
> = {
  google: { label: 'Google', url: (q) => `https://www.google.com/search?q=${q}` },
  duckduckgo: { label: 'DuckDuckGo', url: (q) => `https://duckduckgo.com/?q=${q}` },
  yandex: { label: 'Yandex', url: (q) => `https://yandex.com/search/?text=${q}` },
  yahoo: { label: 'Yahoo', url: (q) => `https://search.yahoo.com/search?p=${q}` },
};

export type SettingsState = {
  // appearance — `theme` drives the app chrome only; `readerTheme` drives only
  // the open document's reading surface (independent of the app theme).
  theme: ThemeName;
  readerTheme: ReaderThemeName;

  // signature features
  highlightingEnabled: boolean;
  bottomSheetEnabled: boolean;
  searchEngine: SearchEngine;
  openLinksIn: OpenLinksIn; // where result links open: in-app mini browser or system browser
  nativeSelectionMenu: boolean; // show the OS copy/paste/share menu on text selection
  selectionPeekHeight: number; // px height the selection sheet peeks to on open

  // reader behavior
  readingMode: ReadingMode;

  // typography (reflowable formats)
  fontFamily: ReadingFontKey;
  fontSize: number; // percent, 80–200
  fontWeight: number; // 300–700 (thickness)
  textAlign: TextAlign;
  hyphenation: boolean;
  pageMargins: boolean;
  lineSpacing: number; // 0–100 (%)
  brightness: number | null; // 0–1, null = follow system

  _hydrated: boolean;
  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'light',
      readerTheme: 'light',

      highlightingEnabled: true,
      bottomSheetEnabled: true,
      searchEngine: 'google',
      openLinksIn: 'in-app',
      nativeSelectionMenu: false,
      selectionPeekHeight: 168,

      readingMode: 'scroll',

      fontFamily: 'original',
      fontSize: 100,
      fontWeight: 400,
      textAlign: 'justify',
      hyphenation: true,
      pageMargins: true,
      lineSpacing: 40,
      brightness: null,

      _hydrated: false,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
    }),
    {
      name: 'revpdf-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ _hydrated, set, ...rest }) => rest,
      onRehydrateStorage: () => (state) => {
        state?.set('_hydrated', true);
      },
    },
  ),
);
