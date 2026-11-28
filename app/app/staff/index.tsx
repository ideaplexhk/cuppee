// Café tablet. Polls the stand feed every second: when a cup lands on the stand, the member's card
// appears here with their usual order and stamp count. Staff confirm (adds stamp + beans) or dismiss.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api, ApiError, type FeedEvent, type Reward, type VisitResult } from '../../src/api';
import { useSession } from '../../src/session';
import { QrScanner } from '../../src/components/QrScanner';
import { Button, Card, ErrorText, StampRow } from '../../src/components/ui';
import { colors, space, type } from '../../src/theme';
import { LanguageSwitch, useT } from '../../src/i18n';
import type { MessageKey, Vars } from '../../src/lib/i18n/core';

type T = (key: MessageKey, vars?: Vars) => string;

type Feed = { cafe: { id: string; name: string }; events: FeedEvent[]; serverTime: number };
type Balances = { stamps: number; stampGoal: number; stampCardReady: boolean; stampReward: string; beans: number; rewards: Reward[] };
type Lookup = { member: { id: string; name: string | null; preferences: Record<string, any> }; stamps: number; stampGoal: number; beans: number };

const POLL_MS = 1000;

function prefLine(t: T, p: Record<string, any>): string {
  const parts = [p.drink, p.milk, p.sweetness, p.temperature].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  if (p.lastOrder?.name) return t('staff.usualLast', { order: [p.lastOrder.name, ...(p.lastOrder.modifiers ?? [])].join(', ') });
  return t('staff.usualNone');
}

function ago(t: T, at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? t('staff.secondsAgo', { n: s }) : t('staff.minutesAgo', { n: Math.round(s / 60) });
}

export default function StaffHome() {
  const { staffToken, staff, setStaff } = useSession();
  const { t } = useT();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  const [cardMember, setCardMember] = useState<{ code: string; data: Lookup } | null>(null);
  const [redeemFor, setRedeemFor] = useState<{ id: string; name: string | null } | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const seen = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (!staffToken) return;
    try {
      const f = await api<Feed>('/v1/staff/feed', { token: staffToken });
      // Buzz once for each newly landed cup.
      for (const e of f.events) {
        if (!seen.current.has(e.id)) {
          if (seen.current.size > 0 && e.status === 'pending') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          seen.current.add(e.id);
        }
      }
      setFeed(f);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await setStaff(null);
      else setError((e as Error).message);
    }
  }, [staffToken, setStaff]);

  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, POLL_MS);
      return () => clearInterval(t);
    }, [load]),
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!staffToken) return <Redirect href="/staff/login" />;

  function visitToast(name: string | null, v: VisitResult) {
    const who = name ?? t('common.member');
    if (v.cooldown) return setToast(t('staff.toastCooldown', { name: who }));
    const ready = v.balances.stampCardReady ? t('staff.toastReady') : '';
    setToast(t('staff.toastVisit', { name: who, stamps: v.balances.stamps, goal: v.balances.stampGoal, beans: v.awarded.beans, ready }));
  }

  async function confirm(e: FeedEvent) {
    setBusyId(e.id);
    try {
      const v = await api<VisitResult>(`/v1/staff/events/${e.id}/confirm`, { method: 'POST', token: staffToken });
      visitToast(e.member?.name ?? null, v);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(e: FeedEvent) {
    setBusyId(e.id);
    try {
      await api(`/v1/staff/events/${e.id}/dismiss`, { method: 'POST', token: staffToken });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function onCardScanned(code: string) {
    setScan(false);
    try {
      const data = await api<Lookup>('/v1/staff/card/lookup', { token: staffToken, body: { code } });
      setCardMember({ code, data });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function recordCardVisit() {
    if (!cardMember) return;
    try {
      const v = await api<VisitResult>('/v1/staff/visits', { token: staffToken, body: { code: cardMember.code } });
      visitToast(cardMember.data.member.name, v);
      setCardMember(null);
    } catch (e) {
      setError((e as Error).message);
      setCardMember(null);
    }
  }

  async function openRedeem(m: { id: string; name: string | null }) {
    setCardMember(null);
    setRedeemFor(m);
    setBalances(null);
    try {
      setBalances(await api<Balances>(`/v1/staff/member/${m.id}/balances`, { token: staffToken }));
    } catch (e) {
      setError((e as Error).message);
      setRedeemFor(null);
    }
  }

  function redeem(kind: 'stamp-card' | 'reward', label: string, rewardId?: string) {
    if (!redeemFor) return;
    Alert.alert(t('staff.redeemConfirmTitle', { label }), t('staff.redeemConfirmBody', { name: redeemFor.name ?? t('staff.thisMember') }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('staff.redeemAction'),
        onPress: async () => {
          try {
            await api(`/v1/staff/redeem/${kind}`, { token: staffToken, body: { memberId: redeemFor.id, rewardId } });
            setToast(t('staff.redeemed', { label }));
            setRedeemFor(null);
            load();
          } catch (e) {
            setError((e as Error).message);
          }
        },
      },
    ]);
  }

  async function signOut() {
    await setStaff(null);
    router.replace('/');
  }

  const now = feed?.serverTime ?? Date.now();
  const pending = feed?.events.filter((e) => e.status === 'pending') ?? [];
  const other = feed?.events.filter((e) => e.status !== 'pending') ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }}>
      <View style={styles.header}>
        <View>
          <Text style={type.title}>{feed?.cafe.name ?? t('staff.counter')}</Text>
          <Text style={type.small}>{t('staff.subtitle', { name: staff?.name ?? '' })}</Text>
        </View>
        <View style={{ flexDirection: 'row' }}>
          <LanguageSwitch style={{ marginRight: space(2) }} />
          <Button title={t('staff.scanCard')} kind="accent" onPress={() => setScan(true)} style={{ marginRight: space(2) }} />
          <Button title={t('common.signOut')} kind="secondary" onPress={signOut} />
        </View>
      </View>
      {toast ? <Text style={styles.toast}>{toast}</Text> : null}
      <ErrorText error={error} />

      <ScrollView contentContainerStyle={{ padding: space(5) }}>
        {pending.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: space(12) }}>
            <Text style={type.h2}>{t('staff.waiting')}</Text>
            <Text style={type.small}>{t('staff.waitingHint')}</Text>
          </Card>
        ) : null}

        {pending.map((e) => (
          <Card key={e.id} style={styles.eventCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{e.member?.name ?? t('common.member')}</Text>
              <Text style={[type.body, { marginVertical: space(1) }]}>{prefLine(t, e.member?.preferences ?? {})}</Text>
              {e.member?.preferences?.notes ? <Text style={type.small}>{t('staff.note', { note: e.member.preferences.notes })}</Text> : null}
              <StampRow stamps={e.member?.stamps ?? 0} goal={e.member?.stampGoal ?? 9} size={18} />
              <Text style={type.small}>
                {ago(t, e.readAt, now)}
                {e.cup?.nickname ? ` · ${e.cup.nickname}` : ''}
                {e.member?.recentVisit ? t('staff.recentVisit') : ''}
              </Text>
              {e.member?.stampCardReady ? <Text style={styles.ready}>{t('staff.cardComplete')}</Text> : null}
            </View>
            <View style={{ width: 200 }}>
              <Button title={t('staff.confirmVisit')} onPress={() => confirm(e)} busy={busyId === e.id} />
              {e.member ? <Button title={t('staff.redeem')} kind="secondary" onPress={() => openRedeem({ id: e.member!.id, name: e.member!.name })} /> : null}
              <Button title={t('staff.notThisOrder')} kind="ghost" onPress={() => dismiss(e)} />
            </View>
          </Card>
        ))}

        {other.map((e) => (
          <Card key={e.id} style={[styles.eventCard, { opacity: 0.8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={type.h2}>
                {e.status === 'unlinked_cup' ? t('staff.unlinkedCup') : e.status === 'unknown_cup' ? t('staff.unknownCup') : t('staff.readFailed')}
              </Text>
              <Text style={type.small}>
                {e.status === 'unlinked_cup'
                  ? t('staff.unlinkedHint')
                  : e.status === 'unknown_cup'
                    ? t('staff.unknownHint', { uid: e.uid ?? '?' })
                    : t('staff.failedHint', { reason: e.rejectReason ?? '?' })}{' '}
                · {ago(t, e.readAt, now)}
              </Text>
            </View>
            <Button title={t('staff.clear')} kind="ghost" onPress={() => dismiss(e)} />
          </Card>
        ))}
      </ScrollView>

      <QrScanner visible={scan} title={t('staff.scanTitle')} onClose={() => setScan(false)} onScan={onCardScanned} />

      <Modal visible={!!cardMember} transparent animationType="fade" onRequestClose={() => setCardMember(null)}>
        <View style={styles.backdrop}>
          <Card style={styles.sheet}>
            <Text style={styles.name}>{cardMember?.data.member.name ?? t('common.member')}</Text>
            <Text style={type.body}>{prefLine(t, cardMember?.data.member.preferences ?? {})}</Text>
            <StampRow stamps={cardMember?.data.stamps ?? 0} goal={cardMember?.data.stampGoal ?? 9} size={18} />
            <Text style={type.small}>{t('staff.beansCount', { beans: cardMember?.data.beans ?? 0 })}</Text>
            <Button title={t('staff.recordVisit')} onPress={recordCardVisit} />
            <Button title={t('staff.redeem')} kind="secondary" onPress={() => cardMember && openRedeem({ id: cardMember.data.member.id, name: cardMember.data.member.name })} />
            <Button title={t('common.close')} kind="ghost" onPress={() => setCardMember(null)} />
          </Card>
        </View>
      </Modal>

      <Modal visible={!!redeemFor} transparent animationType="fade" onRequestClose={() => setRedeemFor(null)}>
        <View style={styles.backdrop}>
          <Card style={styles.sheet}>
            <Text style={styles.name}>{t('staff.redeemFor', { name: redeemFor?.name ?? t('staff.member') })}</Text>
            {!balances ? (
              <Text style={type.small}>{t('common.loading')}</Text>
            ) : (
              <>
                <Text style={[type.h2, { marginTop: space(3) }]}>{t('staff.stampCard')}</Text>
                <StampRow stamps={balances.stamps} goal={balances.stampGoal} size={18} />
                <Button
                  title={balances.stampCardReady ? t('staff.redeemItem', { reward: balances.stampReward }) : t('staff.stampsToGo', { count: balances.stampGoal - balances.stamps })}
                  disabled={!balances.stampCardReady}
                  kind="accent"
                  onPress={() => redeem('stamp-card', balances.stampReward)}
                />
                <Text style={[type.h2, { marginTop: space(3) }]}>{t('staff.beansTitle', { beans: balances.beans })}</Text>
                {balances.rewards
                  .filter((r) => !r.cafeId || r.cafeId === feed?.cafe.id)
                  .map((r) => (
                    <Button
                      key={r.id}
                      title={t('staff.rewardOption', { title: r.title, cost: r.costBeans })}
                      kind="secondary"
                      disabled={balances.beans < r.costBeans}
                      onPress={() => redeem('reward', r.title, r.id)}
                    />
                  ))}
              </>
            )}
            <Button title={t('common.close')} kind="ghost" onPress={() => setRedeemFor(null)} />
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space(5), paddingTop: space(3), flexWrap: 'wrap' },
  toast: { backgroundColor: colors.green, color: colors.cream, padding: space(3), marginHorizontal: space(5), borderRadius: 12, fontWeight: '600', overflow: 'hidden' },
  eventCard: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 26, fontWeight: '800', color: colors.green },
  ready: { color: colors.orange, fontWeight: '700', marginTop: space(1) },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: space(5) },
  sheet: { width: '100%', maxWidth: 480 },
});
