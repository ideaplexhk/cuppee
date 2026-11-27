import { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { api, type Cup, type Summary } from '../../src/api';
import { useSession } from '../../src/session';
import { useMemberQuery } from '../../src/lib/useApi';
import { Button, Card, ErrorText, Screen, Title } from '../../src/components/ui';
import { colors, radius, space, type } from '../../src/theme';

const FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'drink', label: 'Usual drink', placeholder: 'e.g. Flat white' },
  { key: 'milk', label: 'Milk', placeholder: 'e.g. Oat' },
  { key: 'sweetness', label: 'Sweetness', placeholder: 'e.g. No sugar' },
  { key: 'temperature', label: 'Temperature', placeholder: 'e.g. Extra hot' },
  { key: 'notes', label: 'Notes for the barista', placeholder: 'Anything else' },
];

export default function Profile() {
  const { memberToken, setMember } = useSession();
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
    setPrefs(Object.fromEntries(FIELDS.map((f) => [f.key, p[f.key] ?? ''])));
  }, [summary.data]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/v1/me', { method: 'PATCH', token: memberToken, body: { displayName: name, preferences: prefs } });
      setMsg('Saved');
      setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function unlink(cup: Cup) {
    Alert.alert('Unlink this cup?', 'It will stop identifying you at the counter. You can link it again later.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Unlink',
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
      <Title>Me</Title>
      <ErrorText error={error ?? summary.error} />

      <Card>
        <Text style={type.small}>Name shown to baristas</Text>
        <TextInput value={name} onChangeText={setName} style={input} />
        <Text style={[type.h2, { marginBottom: space(2) }]}>How you like your coffee</Text>
        <Text style={[type.small, { marginBottom: space(3) }]}>Baristas see this when your cup lands on the stand.</Text>
        {FIELDS.map((f) => (
          <View key={f.key}>
            <Text style={type.small}>{f.label}</Text>
            <TextInput value={prefs[f.key] ?? ''} placeholder={f.placeholder} onChangeText={(t) => setPrefs((p) => ({ ...p, [f.key]: t }))} style={input} />
          </View>
        ))}
        {last ? <Text style={[type.small, { marginBottom: space(2) }]}>Last order: {[last.name, ...(last.modifiers ?? [])].join(', ')}</Text> : null}
        <Button title={msg ?? 'Save'} onPress={save} busy={busy} />
      </Card>

      <Card>
        <Text style={[type.h2, { marginBottom: space(2) }]}>My cups</Text>
        {cups.data?.length === 0 ? <Text style={type.small}>No cups linked yet.</Text> : null}
        {cups.data?.map((c) => (
          <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space(2) }}>
            <View>
              <Text style={type.body}>{c.nickname ?? c.colourway ?? 'CUPPEE cup'}</Text>
              <Text style={type.small}>
                {c.colourway ?? ''} · linked {new Date(c.linkedAt).toLocaleDateString()}
              </Text>
            </View>
            <Text style={{ color: colors.danger }} onPress={() => unlink(c)}>
              Unlink
            </Text>
          </View>
        ))}
        <Button title="Link a cup" kind="secondary" onPress={() => router.push('/link-cup')} />
      </Card>

      <Text style={[type.small, { textAlign: 'center' }]}>{summary.data?.member.phone}</Text>
      <Button title="Sign out" kind="ghost" onPress={signOut} />
      <Button title="Open café staff mode" kind="ghost" onPress={() => router.push('/staff/login')} />
    </Screen>
  );
}
