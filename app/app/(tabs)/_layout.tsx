import type { ColorValue } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../../src/session';
import { colors } from '../../src/theme';

export default function TabsLayout() {
  const { ready, memberToken } = useSession();
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
      <Tabs.Screen name="card" options={{ title: 'Card', tabBarIcon: icon('qr-code-outline') }} />
      <Tabs.Screen name="rewards" options={{ title: 'Rewards', tabBarIcon: icon('gift-outline') }} />
      <Tabs.Screen name="map" options={{ title: 'Cafés', tabBarIcon: icon('map-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Me', tabBarIcon: icon('person-outline') }} />
    </Tabs>
  );
}
