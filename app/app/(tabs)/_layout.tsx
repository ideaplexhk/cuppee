import type { ColorValue } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../../src/session';
import { colors } from '../../src/theme';
import { useT } from '../../src/i18n';

export default function TabsLayout() {
  const { ready, memberToken } = useSession();
  const { t } = useT();
  if (ready && !memberToken) return <Redirect href="/sign-in" />;
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={typeof color === 'string' ? color : undefined} size={size} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.cream, borderTopColor: colors.line },
      }}
    >
      <Tabs.Screen name="card" options={{ title: t('tabs.card'), tabBarIcon: icon('qr-code-outline') }} />
      <Tabs.Screen name="rewards" options={{ title: t('tabs.rewards'), tabBarIcon: icon('gift-outline') }} />
      <Tabs.Screen name="map" options={{ title: t('tabs.cafes'), tabBarIcon: icon('map-outline') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.me'), tabBarIcon: icon('person-outline') }} />
    </Tabs>
  );
}
