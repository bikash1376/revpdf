import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// Import only the icon set we use so Metro doesn't bundle ~20 icon-font TTFs (~5 MB).
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initDatabase } from '@/db';
import { useSettings } from '@/store/settings';
import { appThemes } from '@/theme/themes';

export default function RootLayout() {
  const themeName = useSettings((s) => s.theme);
  const theme = appThemes[themeName];

  useEffect(() => {
    initDatabase().catch((e) => console.warn('DB init failed', e));
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PaperProvider
          theme={theme}
          settings={{
            icon: (props) => <MaterialCommunityIcons {...props} />,
          }}>
          <BottomSheetModalProvider>
            <StatusBar style={themeName === 'dark' ? 'light' : 'dark'} />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.colors.background },
                animation: 'slide_from_right',
              }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="document/[id]" />
              <Stack.Screen name="reader/[id]" options={{ animation: 'fade' }} />
              <Stack.Screen name="settings/index" />
              <Stack.Screen name="settings/reader" />
              <Stack.Screen name="settings/search" />
            </Stack>
          </BottomSheetModalProvider>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
