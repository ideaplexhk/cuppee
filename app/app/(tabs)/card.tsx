import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { router } from 'expo-router';
import type { Cup, Summary } from '../../src/api';
import { useMemberQuery } from '../../src/lib/useApi';
import { cardCode, msUntilNext } from '../../src/lib/card';
import { Button, Card, ErrorText, StampRow } from '../../src/components/ui';
import { colors, space, type } from '../../src/theme';

type CardKey = { memberId: string; cardKey: string; windowMs: number; serverTime: number };

export default function CardScreen() {
  const summary = useMemberQuery<Summary>('/v1/me');
  const card = useMemberQuery<CardKey>('/v1/me/card');
  const cups = useMemberQuery<Cup[]>('/v1/me/cups');
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(Date.now());

  // Correct for a phone clock that is off, so the code matches the server's window.
  useEffect(() => {
    if (card.data) setOffset(card.data.serverTime - Date.now());
  }, [card.data]);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const s = summary.data;
  const now = tick + offset;
  const code = card.data ? cardCode(card.data.cardKey, card.data.memberId, card.data.windowMs, now) : null;
  const secs = card.data ? Math.ceil(msUntilNext(card.data.windowMs, now) / 1000) : 0;
  const top = s?.stampCards.find((c) => c.lastVisit) ?? s?.stampCards[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: space(5) }}
        refreshControl={<RefreshControl refreshing={summary.loading} onRefresh={() => (summary.reload(), card.reload(), cups.reload())} />}
      >
        <Text style={type.title}>Hi{s?.member.displayName ? `, ${s.member.displayName}` : ''}</Text>
        <ErrorText error={summary.error ?? card.error} />

        <Card style={{ alignItems: 'center', backgroundColor: colors.green, borderColor: colors.green }}>
          <Text style={styles.cardLabel}>CUPPEE MEMBER</Text>
          <View style={styles.qrWrap}>{code ? <QRCode value={code} size={190} color={colors.green} backgroundColor={colors.cream} /> : <View style={{ width: 190, height: 190 }} />}</View>
          <Text style={styles.cardHint}>No cup with you? Show this to the barista · refreshes in {secs}s</Text>
        </Card>

        <View style={styles.row}>
          <Card style={{ flex: 1, marginRight: space(2) }}>
            <Text style={type.small}>Beans</Text>
            <Text style={styles.big}>{s?.beans ?? '–'}</Text>
            <Text style={type.small}>Spend at any partner café</Text>
          </Card>
          <Card style={{ flex: 1, marginLeft: space(2) }}>
            <Text style={type.small}>Cups linked</Text>
            <Text style={styles.big}>{cups.data?.length ?? '–'}</Text>
            <Text style={type.small} onPress={() => router.push('/link-cup')}>
              + Link a cup
            </Text>
          </Card>
        </View>

        {cups.data && cups.data.length === 0 ? (
          <Card>
            <Text style={type.h2}>Link your CUPPEE cup</Text>
            <Text style={[type.body, { marginVertical: space(2) }]}>Then just put your cup on the stand at the counter. The barista sees your name and your usual, and your stamp is added.</Text>
            <Button title="Link my cup" kind="accent" onPress={() => router.push('/link-cup')} />
          </Card>
        ) : null}

        {top ? (
          <Card>
            <Text style={type.small}>{top.lastVisit ? 'Your café' : 'Stamp card'}</Text>
            <Text style={type.h2}>{top.name}</Text>
            <StampRow stamps={top.stamps} goal={top.goal} />
            <Text style={type.small}>
              {top.stamps >= top.goal ? `Ready: ${top.reward}. Ask at the counter.` : `${top.goal - top.stamps} more for ${top.reward.toLowerCase()}`}
            </Text>
          </Card>
        ) : null}

        {s?.recentVisits.length ? (
          <Card>
            <Text style={[type.h2, { marginBottom: space(2) }]}>Recent visits</Text>
            {s.recentVisits.slice(0, 5).map((v) => (
              <Text key={v.id} style={[type.body, { paddingVertical: space(1) }]}>
                {v.cafeName} · {new Date(v.at).toLocaleDateString()} {v.source === 'stand' ? '· cup' : ''}
              </Text>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cardLabel: { color: colors.cream, letterSpacing: 3, fontWeight: '700', marginBottom: space(3) },
  qrWrap: { padding: space(3), backgroundColor: colors.cream, borderRadius: 16 },
  cardHint: { color: colors.cream, opacity: 0.85, marginTop: space(3), textAlign: 'center', fontSize: 13 },
  row: { flexDirection: 'row' },
  big: { fontSize: 34, fontWeight: '800', color: colors.green, marginVertical: space(1) },
});
