import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import type { Cafe, Summary } from '../../src/api';
import { useMemberQuery } from '../../src/lib/useApi';
import { CafeMap } from '../../src/components/CafeMap';
import { Button, Card, ErrorText, Screen, StampRow, Title } from '../../src/components/ui';
import { colors, space, type } from '../../src/theme';
import { useT } from '../../src/i18n';

export default function MapScreen() {
  const { t } = useT();
  const cafes = useMemberQuery<Cafe[]>('/v1/cafes');
  const summary = useMemberQuery<Summary>('/v1/me');
  const [open, setOpen] = useState<string | null>(null);
  const stampsFor = (id: string) => summary.data?.stampCards.find((c) => c.cafeId === id);

  return (
    <Screen>
      <Title>{t('map.title')}</Title>
      <ErrorText error={cafes.error} />
      {cafes.data ? <CafeMap cafes={cafes.data} onSelect={(c) => setOpen(c.id)} /> : null}
      <View style={{ height: space(4) }} />
      {cafes.data?.map((c) => {
        const card = stampsFor(c.id);
        const expanded = open === c.id;
        return (
          <Pressable key={c.id} onPress={() => setOpen(expanded ? null : c.id)}>
            <Card style={expanded ? { borderColor: colors.green } : undefined}>
              <Text style={type.h2}>
                {c.name}
                {c.nameZh ? `  ${c.nameZh}` : ''}
              </Text>
              <Text style={type.small}>{c.locationConfirmed ? [c.district, c.address].filter(Boolean).join(' · ') : t('map.locationTbc')}</Text>
              {expanded ? (
                <View style={{ marginTop: space(3) }}>
                  {c.description ? <Text style={[type.body, { marginBottom: space(2) }]}>{c.description}</Text> : null}
                  {c.hours ? <Text style={type.small}>{t('map.hours', { hours: c.hours })}</Text> : null}
                  <Text style={[type.small, { marginTop: space(2) }]}>
                    {t('map.terms', { goal: c.stampGoal, reward: c.stampReward, beans: c.beansPerVisit })}
                  </Text>
                  {card ? <StampRow stamps={card.stamps} goal={card.goal} size={18} /> : null}
                  {c.menu.length ? (
                    <View style={{ marginTop: space(2) }}>
                      {c.menu.map((m) => (
                        <View key={m.name} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                          <Text style={type.body}>{m.name}</Text>
                          <Text style={type.body}>{m.priceHkd != null ? `HK$${m.priceHkd}` : ''}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {c.lat != null && c.lng != null ? (
                    <Button
                      title={t('map.directions')}
                      kind="secondary"
                      onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`)}
                    />
                  ) : null}
                </View>
              ) : null}
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
