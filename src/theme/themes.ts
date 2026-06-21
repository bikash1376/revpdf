/**
 * Maps revpdf reading surfaces (tokens.ts) onto react-native-paper MD3 themes,
 * so the native chrome and the document surface always agree.
 */
import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';

import { palette, readingSurfaces, type ThemeName } from './tokens';

function buildTheme(name: ThemeName): MD3Theme {
  const s = readingSurfaces[name];
  const base = name === 'dark' ? MD3DarkTheme : MD3LightTheme;
  const onPrimary = '#FFFFFF';

  return {
    ...base,
    dark: name === 'dark',
    colors: {
      ...base.colors,
      primary: name === 'dark' ? palette.inkBright : palette.ink,
      onPrimary,
      primaryContainer: name === 'dark' ? palette.inkDeep : '#DEE1FF',
      onPrimaryContainer: name === 'dark' ? '#DEE1FF' : palette.inkDeep,
      secondary: s.textSecondary,
      onSecondary: onPrimary,
      background: s.background,
      onBackground: s.text,
      surface: s.surface,
      onSurface: s.text,
      surfaceVariant: s.surfaceVariant,
      onSurfaceVariant: s.textSecondary,
      outline: s.outline,
      outlineVariant: s.outline,
      elevation: {
        ...base.colors.elevation,
        level0: 'transparent',
        level1: s.surface,
        level2: s.surface,
        level3: s.surfaceVariant,
        level4: s.surfaceVariant,
        level5: s.surfaceVariant,
      },
    },
  };
}

export const appThemes: Record<ThemeName, MD3Theme> = {
  light: buildTheme('light'),
  dark: buildTheme('dark'),
  sepia: buildTheme('sepia'),
};
