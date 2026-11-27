import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../src/api';
import { useSession } from '../src/session';
import { Button, ErrorText, Screen } from '../src/components/ui';
import { colors, radius, space, type } from '../src/theme';

export default function SignIn() {
  const { setMember } = useSession();
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
        <Text style={[type.body, { color: colors.muted, marginBottom: space(8) }]}>Specialty coffee, carried with you.</Text>

        {step === 'phone' ? (
          <View>
            <Text style={styles.label}>Mobile number</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="9123 4567"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
            />
            <Text style={styles.label}>Your name (shown to baristas)</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Optional" autoComplete="name" />
            <ErrorText error={error} />
            <Button title="Send code" onPress={sendCode} busy={busy} disabled={phone.replace(/\D/g, '').length < 8} />
          </View>
        ) : (
          <View>
            <Text style={styles.label}>Enter the 6-digit code we sent to {phone}</Text>
            <TextInput
              style={[styles.input, { letterSpacing: 8, fontSize: 24, textAlign: 'center' }]}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              autoFocus
            />
            {devCode ? <Text style={type.small}>Development code: {devCode}</Text> : null}
            <ErrorText error={error} />
            <Button title="Continue" onPress={verify} busy={busy} disabled={code.length !== 6} />
            <Button title="Use a different number" kind="ghost" onPress={() => setStep('phone')} />
          </View>
        )}

        <Button title="Café staff? Open staff mode" kind="ghost" style={{ marginTop: space(10) }} onPress={() => router.push('/staff/login')} />
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
