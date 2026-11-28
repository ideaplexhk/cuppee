import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../src/api';
import { useSession } from '../src/session';
import { Button, ErrorText, Screen } from '../src/components/ui';
import { colors, radius, space, type } from '../src/theme';
import { LanguageSwitch, useT } from '../src/i18n';

export default function SignIn() {
  const { setMember } = useSession();
  const { t } = useT();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ phone: string; devCode?: string }>('/v1/auth/otp/request', { body: { phone } });
      setDevCode(r.devCode ?? null);
      setStep('code');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; isNew: boolean }>('/v1/auth/otp/verify', { body: { phone, code, displayName: name } });
      await setMember(r.token);
      router.replace(r.isNew ? '/link-cup?welcome=1' : '/card');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={styles.logo}>CUPPEE</Text>
        <Text style={[type.body, { color: colors.muted, marginBottom: space(8) }]}>{t('signIn.tagline')}</Text>

        {step === 'phone' ? (
          <View>
            <Text style={styles.label}>{t('signIn.phoneLabel')}</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('signIn.phonePlaceholder')}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
            />
            <Text style={styles.label}>{t('signIn.nameLabel')}</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={t('signIn.optional')} autoComplete="name" />
            <ErrorText error={error} />
            <Button title={t('signIn.sendCode')} onPress={sendCode} busy={busy} disabled={phone.replace(/\D/g, '').length < 8} />
          </View>
        ) : (
          <View>
            <Text style={styles.label}>{t('signIn.codeLabel', { phone })}</Text>
            <TextInput
              style={[styles.input, { letterSpacing: 8, fontSize: 24, textAlign: 'center' }]}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              autoFocus
            />
            {devCode ? <Text style={type.small}>{t('signIn.devCode', { code: devCode })}</Text> : null}
            <ErrorText error={error} />
            <Button title={t('signIn.continue')} onPress={verify} busy={busy} disabled={code.length !== 6} />
            <Button title={t('signIn.differentNumber')} kind="ghost" onPress={() => setStep('phone')} />
          </View>
        )}

        <Button title={t('signIn.staffMode')} kind="ghost" style={{ marginTop: space(10) }} onPress={() => router.push('/staff/login')} />
        <LanguageSwitch />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: { fontSize: 44, fontWeight: '800', color: colors.green, letterSpacing: 4 },
  label: { ...type.small, marginBottom: space(1.5), marginTop: space(3) },
  input: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
    fontSize: 18,
    color: colors.ink,
  },
});
