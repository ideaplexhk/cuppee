import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../src/api';
import { useSession } from '../src/session';
import { nfcAvailable, readCup, type CupTap } from '../src/lib/nfc';
import { QrScanner } from '../src/components/QrScanner';
import { Button, Card, ErrorText, Screen, Title } from '../src/components/ui';
import { colors, radius, space, type } from '../src/theme';

export default function LinkCup() {
  const { welcome } = useLocalSearchParams<{ welcome?: string }>();
  const { memberToken } = useSession();
  const [hasNfc, setHasNfc] = useState(false);
  const [scan, setScan] = useState(false);
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);

  useEffect(() => {
    nfcAvailable().then(setHasNfc);
  }, []);

  async function link(body: CupTap | { qr: string }) {
    setBusy(true);
    setError(null);
    try {
      const cup = await api<{ colourway: string | null; nickname: string | null }>('/v1/me/cups', { token: memberToken, body: { ...body, nickname } });
      setLinked(cup.nickname ?? cup.colourway ?? 'Your cup');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function tap() {
    setError(null);
    try {
      await link(await readCup());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const done = () => router.replace('/card');

  if (linked) {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <Title>Cup linked</Title>
        <Text style={[type.body, { marginBottom: space(6) }]}>
          {linked} is now your membership. Next time, put it on the CUPPEE stand at the counter and the barista will see it’s you.
        </Text>
        <Button title="Done" onPress={done} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{welcome ? 'Welcome to CUPPEE' : 'Link a cup'}</Title>
      <Text style={[type.body, { marginBottom: space(4) }]}>Your cup has a chip in its base. Link it once and it works at every partner café.</Text>

      <Text style={type.small}>Name this cup (optional)</Text>
      <TextInput
        value={nickname}
        onChangeText={setNickname}
        placeholder="e.g. Daily cup"
        style={{ backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: space(3.5), fontSize: 16, marginVertical: space(2) }}
      />

      {hasNfc ? (
        <Card style={{ alignItems: 'center' }}>
          <Text style={[type.h2, { marginBottom: space(2) }]}>Tap your cup</Text>
          <Text style={[type.small, { textAlign: 'center', marginBottom: space(3) }]}>Hold the base of the cup against the top of your phone.</Text>
          <Button title="Start tap" kind="accent" onPress={tap} busy={busy} style={{ alignSelf: 'stretch' }} />
        </Card>
      ) : null}

      <Card style={{ alignItems: 'center' }}>
        <Text style={[type.h2, { marginBottom: space(2) }]}>{hasNfc ? 'Or scan the code' : 'Scan the code on the base'}</Text>
        <Text style={[type.small, { textAlign: 'center', marginBottom: space(3) }]}>The small QR next to the chip on the underside of the cup.</Text>
        <Button title="Scan QR" kind={hasNfc ? 'secondary' : 'accent'} onPress={() => setScan(true)} busy={busy && !hasNfc} style={{ alignSelf: 'stretch' }} />
      </Card>

      <ErrorText error={error} />
      <View style={{ flex: 1 }} />
      <Button title={welcome ? 'I’ll do this later' : 'Cancel'} kind="ghost" onPress={done} />

      <QrScanner
        visible={scan}
        title="Scan the code on your cup"
        onClose={() => setScan(false)}
        onScan={(data) => {
          setScan(false);
          link({ qr: data });
        }}
      />
    </Screen>
  );
}
