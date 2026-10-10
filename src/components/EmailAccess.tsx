import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { cloudRequested, requestEmailCode, signOutCloud, useCloudSession, verifyEmailCode } from '../cloudClient';
import { colors } from '../theme';
import { Button, Field, Notice } from './UI';

export function EmailAccess({ initialEmail = '', disabled = false, purpose = 'request' }: { initialEmail?: string; disabled?: boolean; purpose?: 'request' | 'assistant' }) {
  const session = useCloudSession();
  const [email, setEmail] = useState(initialEmail);
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  if (!cloudRequested) return null;

  async function run(action: () => Promise<void>) {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not verify your email. Please try again.'); }
    finally { pending.current = false; setBusy(false); }
  }

  const locked = disabled || busy || session.loading;
  return <View style={styles.container}>
    {session.user ? <>
      <Text style={styles.title}>Email verified</Text>
      <Text selectable style={styles.help}>{session.user.email}</Text>
      <Text style={styles.help}>{purpose === 'assistant' ? 'You can now use the assistant after agreeing to share your messages.' : 'You can now choose Send request. Signing in does not submit your details.'}</Text>
      <Button title={busy ? 'Signing out…' : 'Sign out'} disabled={locked} variant="secondary" onPress={() => void run(async () => {
        await signOutCloud(); setSentTo(''); setCode('');
      })} />
    </> : session.configured ? <>
      <Text style={styles.title}>Verify your email</Text>
      <Text style={styles.help}>We’ll send a one-time sign-in code. Verification creates or signs in to your FILLOUT account for this session; it does not send your {purpose === 'assistant' ? 'messages' : 'request'}.</Text>
      {sentTo ? <>
        <Text style={styles.help}>Enter the six-digit code sent to {sentTo}.</Text>
        <Field label="Email verification code" value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))} editable={!locked} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" autoCorrect={false} maxLength={6} />
        <Button title={busy ? 'Please wait…' : 'Verify email'} disabled={locked || code.length !== 6} onPress={() => void run(async () => { await verifyEmailCode(sentTo, code); setCode(''); })} />
        <Button title="Send a new code" disabled={locked} variant="secondary" onPress={() => void run(async () => { await requestEmailCode(sentTo); setCode(''); })} />
        <Button title="Use another email" disabled={locked} variant="quiet" onPress={() => { setSentTo(''); setCode(''); setError(''); }} />
      </> : <>
        <Field label="Email for verification" value={email} onChangeText={setEmail} editable={!locked} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" maxLength={254} placeholder="you@example.com" />
        <Button title={session.loading ? 'Checking sign-in…' : busy ? 'Sending code…' : 'Send verification code'} disabled={locked || !email.trim()} onPress={() => void run(async () => {
          const address = email.trim().toLowerCase(); await requestEmailCode(address); setSentTo(address); setCode('');
        })} />
      </>}
    </> : null}
    {!!session.error && <Notice tone="warning">{session.error}</Notice>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 16, gap: 12, marginBottom: 14 },
  title: { color: colors.navy, fontSize: 16, lineHeight: 23, fontWeight: '700' },
  help: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  error: { color: colors.error, fontSize: 13, lineHeight: 20 },
});
