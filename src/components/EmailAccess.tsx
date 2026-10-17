import { useLanguage } from '../LanguageContext';
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { cloudRequested, requestEmailCode, useCloudSession, verifyEmailCode } from '../cloudClient';
import { useAccount } from '../AccountContext';
import { colors } from '../theme';
import { Button, Field, Notice } from './UI';

export function EmailAccess({ initialEmail = '', disabled = false, purpose = 'request' }: { initialEmail?: string; disabled?: boolean; purpose?: 'request' | 'assistant' }) {
  const { t } = useLanguage();
  const session = useCloudSession();
  const account = useAccount();
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
      <Text style={styles.title}>{t("Email verified")}</Text>
      <Text selectable style={styles.help}>{session.user.email}</Text>
      <Text style={styles.help}>{purpose === 'assistant' ? t("You can now use the assistant after agreeing to share your messages.") : t("You can now choose Send request. Signing in does not submit your details.")}</Text>
      <Button title={busy ? t("Signing out…") : t("Sign out")} disabled={locked} variant="secondary" onPress={() => void run(async () => {
        await account.signOut(); setSentTo(''); setCode('');
      })} />
    </> : session.configured ? <>
      <Text style={styles.title}>{t("Verify your email")}</Text>
      <Text style={styles.help}>{t(purpose === 'assistant' ? 'We’ll send a one-time sign-in code. Verification creates or signs in to your FILLOUT account for this session; it does not send your messages.' : 'We’ll send a one-time sign-in code. Verification creates or signs in to your FILLOUT account for this session; it does not send your request.')}</Text>
      {sentTo ? <>
        <Text style={styles.help}>{t('Enter the eight-digit code sent to {email}.', { email: sentTo })}</Text>
        <Field label={t("Email verification code")} accessibilityHint={t("Enter the eight-digit code from your email.")} value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 8))} editable={!locked} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" autoCorrect={false} maxLength={8} />
        <Button title={busy ? t("Please wait…") : t("Verify email")} disabled={locked || code.length !== 8} onPress={() => void run(async () => { await verifyEmailCode(sentTo, code); setCode(''); })} />
        <Button title={t("Send a new code")} disabled={locked} variant="secondary" onPress={() => void run(async () => { await requestEmailCode(sentTo); setCode(''); })} />
        <Button title={t("Use another email")} disabled={locked} variant="quiet" onPress={() => { setSentTo(''); setCode(''); setError(''); }} />
      </> : <>
        <Field label={t("Email for verification")} value={email} onChangeText={setEmail} editable={!locked} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" maxLength={254} placeholder="you@example.com" />
        <Button title={session.loading ? t("Checking sign-in…") : busy ? t("Sending code…") : t("Send verification code")} disabled={locked || !email.trim()} onPress={() => void run(async () => {
          const address = email.trim().toLowerCase(); await requestEmailCode(address); setSentTo(address); setCode('');
        })} />
      </>}
    </> : null}
    {!!session.error && <Notice tone="warning">{t(session.error)}</Notice>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 16, gap: 12, marginBottom: 14 },
  title: { color: colors.navy, fontSize: 16, lineHeight: 23, fontWeight: '700' },
  help: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  error: { color: colors.error, fontSize: 13, lineHeight: 20 },
});
