/**
 * revpdf design tokens.
 *
 * The brief pins the direction: Material Design 3, minimalist, ReadEra-like.
 * So chrome stays quiet MD3 neutral and we spend our one bold move on the thing
 * that IS revpdf's identity — the reading surfaces and the highlight color system.
 *
 * Seed: ink-indigo (deliberately NOT ReadEra's teal). Color is loud in exactly
 * one place: the highlighter swatches.
 */

export type ThemeName = 'light' | 'dark' | 'sepia';

/**
 * Reader-only themes. The app chrome is limited to the three MD3 themes above,
 * but the reading surface gets an extra "twilight" (dim blue-gray night theme)
 * that only ever affects the document view, never the app chrome.
 */
export type ReaderThemeName = ThemeName | 'twilight';

/** Ink-indigo seed and its tonal neighbours, shared across UI themes. */
export const palette = {
  ink: '#3F51B5', // primary seed — "ink", not brand teal
  inkBright: '#5C6BC0',
  inkDeep: '#2A3578',
} as const;

/**
 * Reading surfaces. These drive BOTH the native chrome (mapped into the Paper
 * MD3 themes) and the WebView reader (injected as CSS variables).
 *
 * Note (per spec §7.1): dark text is a soft gray (#C9C9C9), never pure white,
 * to avoid halation on the near-black surface.
 */
export const readingSurfaces: Record<
  ThemeName,
  {
    background: string;
    surface: string; // cards, sheets, app bars
    surfaceVariant: string;
    text: string;
    textSecondary: string;
    link: string;
    outline: string;
  }
> = {
  light: {
    background: '#FBFBFE',
    surface: '#FFFFFF',
    surfaceVariant: '#EEEEF3',
    text: '#1B1B1F',
    textSecondary: '#5B5D66',
    link: palette.ink,
    outline: '#C9CAD2',
  },
  dark: {
    background: '#121212',
    surface: '#1C1C20',
    surfaceVariant: '#26262B',
    text: '#C9C9C9', // soft gray — NOT #FFFFFF
    textSecondary: '#8E8E96',
    link: palette.inkBright,
    outline: '#3A3A40',
  },
  sepia: {
    background: '#F4ECD8',
    surface: '#FBF5E6',
    surfaceVariant: '#EBE0C7',
    text: '#5B4636',
    textSecondary: '#8A7355',
    link: '#9A5B2E',
    outline: '#D8C9A8',
  },
};

/** Twilight: a dim blue-gray night surface, available to the reader only. */
const twilightSurface = {
  background: '#1B2330',
  surface: '#222C3A',
  surfaceVariant: '#2C3848',
  text: '#C0C8D2',
  textSecondary: '#8B97A6',
  link: '#7FB2E5',
  outline: '#33414F',
};

/**
 * Reading surfaces available to the document view. Superset of the app themes
 * with the reader-only "twilight" added. Use this (keyed by ReaderThemeName)
 * everywhere the reader paints its surface; use readingSurfaces for app chrome.
 */
export const readerSurfaces: Record<ReaderThemeName, (typeof readingSurfaces)[ThemeName]> = {
  ...readingSurfaces,
  twilight: twilightSurface,
};

/** Highlighter marker colors — the one place color is allowed to be loud. */
export const highlightColors = [
  { key: 'yellow', value: '#FFE082', label: 'Yellow' },
  { key: 'green', value: '#A5D6A7', label: 'Green' },
  { key: 'blue', value: '#90CAF9', label: 'Blue' },
  { key: 'pink', value: '#F48FB1', label: 'Pink' },
  { key: 'orange', value: '#FFCC80', label: 'Orange' },
  { key: 'purple', value: '#CE93D8', label: 'Purple' },
  { key: 'teal', value: '#80CBC4', label: 'Teal' },
  { key: 'red', value: '#EF9A9A', label: 'Red' },
] as const;

export type HighlightColorKey = (typeof highlightColors)[number]['key'];

/** Bundled reading fonts (spec §7.3). All Google Fonts. */
export const readingFonts = [
  { key: 'original', label: 'Original', stack: 'inherit' },
  { key: 'alice', label: 'Alice', stack: "'Alice', serif" },
  { key: 'comfortaa', label: 'Comfortaa', stack: "'Comfortaa', sans-serif" },
  { key: 'merriweather', label: 'Merriweather', stack: "'Merriweather', serif" },
  { key: 'roboto', label: 'Roboto', stack: "'Roboto', sans-serif" },
  { key: 'notoSerif', label: 'Noto Serif', stack: "'Noto Serif', serif" },
] as const;

export type ReadingFontKey = (typeof readingFonts)[number]['key'];

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;
