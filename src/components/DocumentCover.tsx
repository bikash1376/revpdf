import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

import type { DocFormat } from '@/db';
import { radius } from '@/theme/tokens';

type Props = {
  uri: string | null;
  format: DocFormat;
  width?: number;
  height?: number;
};

const FORMAT_TINT: Record<DocFormat, string> = {
  pdf: '#C5483B',
  epub: '#3F7A4F',
  doc: '#2F5BB7',
  docx: '#2F5BB7',
  txt: '#5B6770',
  md: '#3A6EA5',
  json: '#B8860B',
  csv: '#2E8B57',
  html: '#C2622D',
};

/** Cover thumbnail with a format-tinted fallback when no image is set. */
export function DocumentCover({ uri, format, width = 64, height = 88 }: Props) {
  const theme = useTheme();
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width, height, borderRadius: radius.sm }}
        contentFit="cover"
        transition={120}
      />
    );
  }
  return (
    <View
      style={[
        styles.fallback,
        { width, height, backgroundColor: FORMAT_TINT[format], borderRadius: radius.sm },
      ]}>
      <Text variant="labelMedium" style={styles.fallbackText}>
        {format.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    color: '#FFFFFF',
    letterSpacing: 1,
    fontWeight: '700',
  },
});
