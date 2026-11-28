import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api, type Cafe } from '../../src/api';
import { useSession } from '../../src/session';
import { Button, Card, ErrorText, Screen, Title } from '../../src/components/ui';
import { colors, radius, space, type } from '../../src/theme';
import { LanguageSwitch, useT } from '../../src/i18n';

type StaffItem = { id: string; name: string };

export default function StaffLogin() {
  const { setStaff } = useSession();
  const { t } = useT();
  const [cafes, setCafes] = useState<Cafe[]>([]);
  const [cafe, setCafe] = useState<Cafe | null>(null);
  const [people, setPeople] = useState<StaffItem[]>([]);
  const [person, setPerson] = useState<StaffItem | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Cafe[]>('/v1/cafes').then(setCafes).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (cafe) api<StaffItem[]>(`/v1/staff/cafes/${cafe.id}/staff`).then(setPeople).catch((e) => setError(e.message));
  }, [cafe]);

  async function login(p: string) {
    if (!cafe || !person) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; staff: { id: string; name: string; role: string; cafeId: string } }>('/v1/staff/login', {
        body: { cafeId: cafe.id, staffId: person.id, pin: p },
      });
      await setStaff(r.token, r.staff);
      router.replace('/staff');
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  function press(d: string) {
    if (busy) return;
    const next = d === '⌫' ? pin.slice(0, -1) : (pin + d).slice(0, 6);
    setPin(next);
    if (next.length === 4) login(next);
  }

  return (
    <Screen>
      <Title>{t('staffLogin.title')}</Title>
      {!cafe ? (
        <>
          <Text style={[type.body, { marginBottom: space(3) }]}>{t('staffLogin.whichCafe')}</Text>
          {cafes.map((c) => (
            <Pressable key={c.id} onPress={() => setCafe(c)}>
              <Card>
                <Text style={type.h2}>{c.name}</Text>
              </Card>
            </Pressable>
          ))}
        </>
      ) : !person ? (
        <>
          <Text style={[type.body, { marginBottom: space(3) }]}>{t('staffLogin.whoOnShift', { cafe: cafe.name })}</Text>
          {people.map((p) => (
            <Pressable key={p.id} onPress={() => setPerson(p)}>
              <Card>
                <Text style={type.h2}>{p.name}</Text>
              </Card>
            </Pressable>
          ))}
          <Button title={t('common.back')} kind="ghost" onPress={() => setCafe(null)} />
        </>
      ) : (
        <View style={{ alignItems: 'center' }}>
          <Text style={[type.body, { marginBottom: space(3) }]}>{t('staffLogin.enterPin', { name: person.name })}</Text>
          <View style={{ flexDirection: 'row', marginBottom: space(5) }}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[styles.dot, i < pin.length && { backgroundColor: colors.green }]} />
            ))}
          </View>
          <View style={styles.pad}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) => (
              <Pressable key={i} onPress={() => d && press(d)} style={[styles.key, !d && { opacity: 0 }]}>
                <Text style={styles.keyText}>{d}</Text>
              </Pressable>
            ))}
          </View>
          <Button title={t('common.back')} kind="ghost" onPress={() => (setPerson(null), setPin(''))} />
        </View>
      )}
      <ErrorText error={error} />
      <LanguageSwitch />
      <Button title={t('staffLogin.exit')} kind="ghost" onPress={() => router.replace('/')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.green, marginHorizontal: 8 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: 270, justifyContent: 'center' },
  key: { width: 76, height: 76, margin: 6, borderRadius: radius.pill, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 26, fontWeight: '600', color: colors.green },
});
