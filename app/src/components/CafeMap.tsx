// Web fallback: react-native-maps is native-only, so the web build shows the list alone.
import { Text, View } from 'react-native';
import type { Cafe } from '../api';
import { colors, space, type } from '../theme';
import { useT } from '../i18n';

export function CafeMap(_: { cafes: Cafe[]; onSelect: (c: Cafe) => void }) {
  const { t } = useT();
  return (
    <View style={{ padding: space(4), backgroundColor: colors.creamDeep, borderRadius: 24 }}>
      <Text style={type.small}>{t('map.webOnly')}</Text>
    </View>
  );
}
