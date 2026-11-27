import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, space, type } from '../theme';

export function Screen({ children, scroll = true, style }: { children: React.ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  const inner = <View style={[styles.inner, style]}>{children}</View>;
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {scroll ? <ScrollView contentContainerStyle={{ flexGrow: 1 }}>{inner}</ScrollView> : inner}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={[type.title, { marginBottom: space(4) }]}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  busy,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'accent' | 'ghost';
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = { primary: colors.green, secondary: colors.creamDeep, accent: colors.orange, ghost: 'transparent' }[kind];
  const fg = kind === 'secondary' || kind === 'ghost' ? colors.green : colors.white;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

/** Stamp card: filled cups for stamps earned, outlined for the rest. */
export function StampRow({ stamps, goal, size = 26 }: { stamps: number; goal: number; size?: number }) {
  const shown = Math.min(stamps, goal);
  return (
    <View style={styles.stamps} accessibilityLabel={`${shown} of ${goal} stamps`}>
      {Array.from({ length: goal }).map((_, i) => (
        <View
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            margin: 3,
            borderWidth: 2,
            borderColor: colors.green,
            backgroundColor: i < shown ? (i === goal - 1 ? colors.orange : colors.green) : 'transparent',
          }}
        />
      ))}
    </View>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <Text style={{ color: colors.danger, marginVertical: space(2) }}>{error}</Text> : null;
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream }}>
      <ActivityIndicator color={colors.green} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  inner: { flex: 1, padding: space(5) },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: space(5), marginBottom: space(4), borderWidth: 1, borderColor: colors.line },
  btn: { borderRadius: radius.pill, paddingVertical: space(3.5), paddingHorizontal: space(5), alignItems: 'center', marginVertical: space(1.5) },
  btnText: { fontSize: 16, fontWeight: '700' },
  stamps: { flexDirection: 'row', flexWrap: 'wrap', marginVertical: space(2) },
});
