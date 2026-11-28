import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../src/session';
import { LanguageProvider } from '../src/i18n';
import { colors } from '../src/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <SessionProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.cream },
            }}
          >
            <Stack.Screen name="link-cup" options={{ presentation: 'modal' }} />
          </Stack>
        </SessionProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
