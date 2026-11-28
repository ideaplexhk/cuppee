import { Text, View } from 'react-native';
import type { Reward, Summary } from '../../src/api';
import { useMemberQuery } from '../../src/lib/useApi';
import { Card, ErrorText, Screen, StampRow, Title } from '../../src/components/ui';
import { colors, space, type } from '../../src/theme';
import { useT } from '../../src/i18n';

export default function Rewards() {
  const { t } = useT();
  const summary = useMemberQuery<Summary>('/v1/me');
  const rewards = useMemberQuery<Reward[]>('/v1/rewards');
  const beans = summary.data?.beans ?? 0;

  return (
    <Screen>
      <Title>{t('rewards.title')}</Title>
      <ErrorText error={summary.error ?? rewards.error} />
      <Text style={[type.body, { marginBottom: space(4), color: colors.muted }]}>
        {t('rewards.howTo')}
      </Text>

      <Text style={[type.h2, { marginBottom: space(2) }]}>{t('rewards.stampCards')}</Text>
      {summary.data?.stampCards.map((c) => (
        <Card key={c.cafeId}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={type.h2}>{c.name}</Text>
            <Text style={type.small}>
              {Math.min(c.stamps, c.goal)}/{c.goal}
            </Text>
          </View>
          <StampRow stamps={c.stamps} goal={c.goal} size={22} />
          <Text style={[type.small, c.stamps >= c.goal && { color: colors.orange, fontWeight: '700' }]}>
            {c.stamps >= c.goal ? t('rewards.readyToRedeem', { reward: c.reward }) : c.reward}
          </Text>
        </Card>
      ))}

      <Text style={[type.h2, { marginVertical: space(2) }]}>{t('rewards.spendBeans', { beans })}</Text>
      {rewards.data?.map((r) => {
        const ok = beans >= r.costBeans;
        return (
          <Card key={r.id} style={{ opacity: ok ? 1 : 0.6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={type.h2}>{r.title}</Text>
                <Text style={type.small}>{r.cafeName ? t('rewards.atCafe', { cafe: r.cafeName }) : r.description ?? t('rewards.anyCafe')}</Text>
              </View>
              <Text style={{ fontSize: 18, fontWeight: '800', color: ok ? colors.green : colors.muted }}>{r.costBeans}</Text>
            </View>
            {!ok ? <Text style={[type.small, { marginTop: space(1) }]}>{t('rewards.moreBeans', { count: r.costBeans - beans })}</Text> : null}
          </Card>
        );
      })}
    </Screen>
  );
}
