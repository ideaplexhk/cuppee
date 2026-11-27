// Web fallback: react-native-maps is native-only, so the web build shows the list alone.
import { Text, View } from 'react-native';
import type { Cafe } from '../api';
import { colors, space, type } from '../theme';

export function CafeMap(_: { cafes: Cafe[]; onSelect: (c: Cafe) => void }) {
  return (
    <View style={{ padding: space(4), backgroundColor: colors.creamDeep, borderRadius: 24 }}>
      <Text style={type.small}>The map shows in the phone app.</Text>
    </View>
  );
}
