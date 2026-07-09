// Metro only bundles assets from literal `require` calls, so both variants are spelled out.
export const wordmark = (dark: boolean) =>
  dark
    ? require('@/assets/images/revpdf-wordmark-inverse.png')
    : require('@/assets/images/revpdf-wordmark-ink.png');
