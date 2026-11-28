import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../src/api';
import { useSession } from '../src/session';
import { nfcAvailable, readCup, type CupTap } from '../src/lib/nfc';
import { QrScanner } from '../src/components/QrScanner';
import { Button, Card, ErrorText, Screen, Title } from '../src/components/ui';
import { colors, radius, space, type } from '../src/theme';
import { useT } from '../src/i18n';

export default function LinkCup() {
  const { welcome } = useLocalSearchParams<{ welcome?: string }>();
  const { memberToken } = useSession();
  const { t } = useT();
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
      setLinked(cup.nickname ?? cup.colourway ?? t('link.yourCup'));
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
        <Title>{t('link.doneTitle')}</Title>
        <Text style={[type.body, { marginBottom: space(6) }]}>
          {t('link.doneBody', { cup: linked })}
        </Text>
        <Button title={t('common.done')} onPress={done} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{welcome ? t('link.welcome') : t('link.title')}</Title>
      <Text style={[type.body, { marginBottom: space(4) }]}>{t('link.intro')}</Text>

      <Text style={type.small}>{t('link.nameLabel')}</Text>
      <TextInput
        value={nickname}
        onChangeText={setNickname}
        placeholder={t('link.namePlaceholder')}
        style={{ backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: space(3.5), fontSize: 16, marginVertical: space(2) }}
      />

      {hasNfc ? (
        <Card style={{ alignItems: 'center' }}>
          <Text style={[type.h2, { marginBottom: space(2) }]}>{t('link.tapTitle')}</Text>
          <Text style={[type.small, { textAlign: 'center', marginBottom: space(3) }]}>{t('link.tapHint')}</Text>
          <Button title={t('link.startTap')} kind="accent" onPress={tap} busy={busy} style={{ alignSelf: 'stretch' }} />
        </Card>
      ) : null}

      <Card style={{ alignItems: 'center' }}>
        <Text style={[type.h2, { marginBottom: space(2) }]}>{hasNfc ? t('link.orScan') : t('link.scanBase')}</Text>
        <Text style={[type.small, { textAlign: 'center', marginBottom: space(3) }]}>{t('link.scanHint')}</Text>
        <Button title={t('link.scanQr')} kind={hasNfc ? 'secondary' : 'accent'} onPress={() => setScan(true)} busy={busy && !hasNfc} style={{ alignSelf: 'stretch' }} />
      </Card>

      <ErrorText error={error} />
      <View style={{ flex: 1 }} />
      <Button title={welcome ? t('link.later') : t('common.cancel')} kind="ghost" onPress={done} />

      <QrScanner
        visible={scan}
        title={t('link.scannerTitle')}
        onClose={() => setScan(false)}
        onScan={(data) => {
          setScan(false);
          link({ qr: data });
        }}
      />
    </Screen>
  );
}
