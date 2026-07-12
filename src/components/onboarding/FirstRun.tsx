import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';

import { PdfToEpubConverter, type ConvertProgress } from '@/components/PdfToEpubConverter';
import { spacing } from '@/theme/tokens';

import { DemoVideo } from './DemoVideo';
import { SuccessTick } from './SuccessTick';
import { WaveProgress } from './WaveProgress';

type Phase = 'pitch' | 'converting' | 'done';

type Props = {
  /** Import via the normal file picker — the existing library flow, untouched. */
  onImport: () => void;
  onOpen: (documentId: string) => void;
  onError: (message: string) => void;
  /**
   * Play the demo clip straight away, instead of only while a conversion runs.
   * Set when the screen was opened deliberately from the help button — you came
   * to watch, so don't make converting a PDF the price of admission.
   */
  demoUpfront?: boolean;
};

/**
 * First-run screen (P2). Instead of an empty shelf, it makes the case for EPUB
 * over PDF and offers to convert one — the conversion runs on-device while a
 * demo clip loops, and lands on a tick + "Open now".
 *
 * Shown only while the library is empty; importing normally is still right there.
 */
export function FirstRun({ onImport, onOpen, onError, demoUpfront }: Props) {
  const theme = useTheme();
  const [phase, setPhase] = useState<Phase>('pitch');
  const [source, setSource] = useState<{ uri: string; title: string } | null>(null);
  const [progress, setProgress] = useState<ConvertProgress>({ progress: 0, stage: '' });
  const [newId, setNewId] = useState<string | null>(null);

  const videoH = Math.min(360, Dimensions.get('window').height * 0.34);

  const pickPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    setProgress({ progress: 0, stage: 'Getting ready' });
    setSource({ uri: a.uri, title: a.name.replace(/\.[^.]+$/, '') });
    setPhase('converting');
  };

  const handleDone = useCallback((id: string) => {
    setNewId(id);
    setPhase('done');
  }, []);

  const handleError = useCallback(
    (m: string) => {
      setPhase('pitch');
      setSource(null);
      onError(m);
    },
    [onError],
  );

  return (
    <View style={styles.root}>
      <PdfToEpubConverter
        source={phase === 'converting' ? source : null}
        onProgress={setProgress}
        onDone={handleDone}
        onError={handleError}
      />

      {/* Progress is pinned to the top for the whole conversion, per the brief. */}
      {phase !== 'pitch' && (
        <View style={styles.top}>
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
            {phase === 'done' ? 'Ready to read' : 'Setting this up…'}
          </Text>
          <Text
            variant="bodySmall"
            numberOfLines={1}
            style={{ color: theme.colors.onSurfaceVariant, marginBottom: spacing.sm }}>
            {phase === 'done' ? 'Converted to EPUB' : progress.stage}
          </Text>
          <WaveProgress progress={phase === 'done' ? 1 : progress.progress} />
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}>
        {phase === 'pitch' ? (
          <>
            {demoUpfront && <DemoVideo height={videoH} />}
            <Text variant="headlineSmall" style={[styles.h, { color: theme.colors.onSurface }]}>
              EPUB reads better than PDF
            </Text>
            <Text
              variant="bodyMedium"
              style={[styles.p, { color: theme.colors.onSurfaceVariant }]}>
              A PDF is a fixed page — it can’t reflow, so on a phone you end up pinching and
              panning. An EPUB adapts to your screen, your font and your text size.
            </Text>
            <Text
              variant="bodySmall"
              style={[styles.p, { color: theme.colors.onSurfaceVariant, opacity: 0.8 }]}>
              Converting happens entirely on your device. Nothing is uploaded.
            </Text>

            <Button mode="contained" icon="autorenew" onPress={pickPdf} style={styles.cta}>
              Try now
            </Button>
            <Button mode="text" icon="plus" onPress={onImport}>
              Add a document instead
            </Button>
          </>
        ) : (
          <>
            <DemoVideo height={videoH} />
            {phase === 'done' ? (
              <View style={styles.doneWrap}>
                <SuccessTick color={theme.colors.primary} />
                <Button
                  mode="contained"
                  icon="book-open-variant"
                  style={styles.cta}
                  onPress={() => newId && onOpen(newId)}>
                  Open now
                </Button>
              </View>
            ) : (
              <Text
                variant="bodySmall"
                style={[styles.p, styles.hint, { color: theme.colors.onSurfaceVariant }]}>
                While you wait — here’s how RevPdf works.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  h: { textAlign: 'center', marginBottom: spacing.xs },
  p: { textAlign: 'center' },
  hint: { marginTop: spacing.md },
  cta: { marginTop: spacing.md, alignSelf: 'center', minWidth: 200 },
  doneWrap: { alignItems: 'center', marginTop: spacing.lg, gap: spacing.sm },
});
