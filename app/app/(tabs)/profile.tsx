import { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { api, type Cup, type Summary } from '../../src/api';
import { useSession } from '../../src/session';
import { useMemberQuery } from '../../src/lib/useApi';
import { Button, Card, ErrorText, Screen, Title } from '../../src/components/ui';
import { colors, radius, space, type } from '../../src/theme';
import { LanguageSwitch, useT } from '../../src/i18n';
import type { MessageKey } from '../../src/lib/i18n/core';

// Preference keys saved on the member; labels come from i18n (profile.<key> and profile.<key>Placeholder).
const FIELDS = ['drink', 'milk', 'sweetness', 'temperature', 'notes'] as const;
const label = (k: (typeof FIELDS)[number]) => `profile.${k}` as MessageKey;
const hint = (k: (typeof FIELDS)[number]) => `profile.${k}Placeholder` as MessageKey;

export default function Profile() {
  const { memberToken, setMember } = useSession();
  const { t, date } = useT();
  const summary = useMemberQuery<Summary>('/v1/me');
  const cups = useMemberQuery<Cup[]>('/v1/me/cups');
  const [name, setName] = useState('');
  const [prefs, setPrefs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!summary.data) return;
    setName(summary.data.member.displayName ?? '');
    const p = summary.data.member.preferences ?? {};
    setPrefs(Object.fromEntries(FIELDS.map((f) => [f, p[f] ?? ''])));
  }, [summary.data]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/v1/me', { method: 'PATCH', token: memberToken, body: { displayName: name, preferences: prefs } });
      setMsg(t('common.saved'));
      setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function unlink(cup: Cup) {
    Alert.alert(t('profile.unlinkTitle'), t('profile.unlinkBody'), [
      { text: t('profile.keep'), style: 'cancel' },
      {
        text: t('profile.unlink'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/v1/me/cups/${cup.id}`, { method: 'DELETE', token: memberToken });
            cups.reload();
          } catch (e) {
            setError((e as Error).message);
          }
        },
      },
    ]);
  }

  async function signOut() {
    await api('/v1/auth/logout', { method: 'POST', token: memberToken }).catch(() => {});
    await setMember(null);
    router.replace('/sign-in');
  }

  const last = summary.data?.member.preferences?.lastOrder as { name: string; modifiers: string[] } | undefined;
  const input = { backgroundColor: colors.cream, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: space(3), fontSize: 16, marginBottom: space(3) };

  return (
    <Screen>
      <Title>{t('profile.title')}</Title>
      <ErrorText error={error ?? summary.error} />

      <Card>
        <Text style={type.small}>{t('profile.nameLabel')}</Text>
        <TextInput value={name} onChangeText={setName} style={input} />
        <Text style={[type.h2, { marginBottom: space(2) }]}>{t('profile.coffeeTitle')}</Text>
        <Text style={[type.small, { marginBottom: space(3) }]}>{t('profile.coffeeHint')}</Text>
        {FIELDS.map((f) => (
          <View key={f}>
            <Text style={type.small}>{t(label(f))}</Text>
            <TextInput value={prefs[f] ?? ''} placeholder={t(hint(f))} onChangeText={(v) => setPrefs((p) => ({ ...p, [f]: v }))} style={input} />
          </View>
        ))}
        {last ? <Text style={[type.small, { marginBottom: space(2) }]}>{t('profile.lastOrder', { order: [last.name, ...(last.modifiers ?? [])].join(', ') })}</Text> : null}
        <Button title={msg ?? t('common.save')} onPress={save} busy={busy} />
      </Card>

      <Card>
        <Text style={[type.h2, { marginBottom: space(2) }]}>{t('profile.myCups')}</Text>
        {cups.data?.length === 0 ? <Text style={type.small}>{t('profile.noCups')}</Text> : null}
        {cups.data?.map((c) => (
          <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space(2) }}>
            <View>
              <Text style={type.body}>{c.nickname ?? c.colourway ?? t('common.cuppeeCup')}</Text>
              <Text style={type.small}>
                {c.colourway ?? ''} · {t('profile.linkedOn', { date: date(c.linkedAt) })}
              </Text>
            </View>
            <Text style={{ color: colors.danger }} onPress={() => unlink(c)}>
              {t('profile.unlink')}
            </Text>
          </View>
        ))}
        <Button title={t('profile.linkCup')} kind="secondary" onPress={() => router.push('/link-cup')} />
      </Card>

      <Text style={[type.small, { textAlign: 'center' }]}>{summary.data?.member.phone}</Text>
      <LanguageSwitch />
      <Button title={t('common.signOut')} kind="ghost" onPress={signOut} />
      <Button title={t('profile.staffMode')} kind="ghost" onPress={() => router.push('/staff/login')} />
    </Screen>
  );
}
