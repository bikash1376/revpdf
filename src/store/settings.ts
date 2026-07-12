/**
 * Global, locally-persisted settings (spec §8 + §7 reader display controls).
 * Everything revpdf remembers lives here. No network, no accounts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type {
  HighlightColorKey,
  ReaderThemeName,
  ReadingFontKey,
  ThemeName,
} from '../theme/tokens';

export type SearchEngine = 'google' | 'duckduckgo' | 'yandex' | 'yahoo' | 'disabled';
export type ReadingMode = 'paginated' | 'scroll';
export type TextAlign = 'justify' | 'left' | 'center' | 'right';
export type OpenLinksIn = 'in-app' | 'external';

/**
 * `headerTrim` is how many CSS px of the engine's own chrome — logo, search box,
 * the query you already know you typed — sit above the first result. The
 * selection sheet scrolls past it so it opens *on* the results. Each engine
 * wastes a different amount of room, hence a value per engine rather than one
 * constant.
 */
export const SEARCH_ENGINES: Record<
  Exclude<SearchEngine, 'disabled'>,
  { label: string; url: (q: string) => string; headerTrim: number }
> = {
  google: {
    label: 'Google',
    url: (q) => `https://www.google.com/search?q=${q}`,
    headerTrim: 190,
  },
  duckduckgo: {
    label: 'DuckDuckGo',
    url: (q) => `https://duckduckgo.com/?q=${q}`,
    headerTrim: 130,
  },
  yandex: {
    label: 'Yandex',
    url: (q) => `https://yandex.com/search/?text=${q}`,
    headerTrim: 160,
  },
  yahoo: {
    label: 'Yahoo',
    url: (q) => `https://search.yahoo.com/search?p=${q}`,
    headerTrim: 170,
  },
};

export type SettingsState = {
  // appearance — `theme` drives the app chrome only; `readerTheme` drives only
  // the open document's reading surface (independent of the app theme).
  theme: ThemeName;
  readerTheme: ReaderThemeName;

  // signature features
  highlightingEnabled: boolean;
  /** Color the one-tap highlight button applies, without asking. */
  defaultHighlightColor: HighlightColorKey;
  bottomSheetEnabled: boolean;
  searchEngine: SearchEngine;
  openLinksIn: OpenLinksIn; // where result links open: in-app mini browser or system browser

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
      defaultHighlightColor: 'yellow',
      bottomSheetEnabled: true,
      searchEngine: 'google',
      openLinksIn: 'in-app',

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
