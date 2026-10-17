import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAccount } from '../AccountContext';
import { useLanguage } from '../LanguageContext';
import { Button, Field, Notice } from '../components/UI';
import { cloudConfigured, cloudConfigurationError, changeCloudPassword, refreshCloudUser, requestCloudEmailChange,
  requestSignInCode, saveCloudProfile, signInWithPassword, signUpWithPassword, verifyEmailCode } from '../cloudClient';
import { waitForDraftSaves } from '../draftStorage';
import { colors } from '../theme';

export function AccountScreen({ onClose, locked = false }: { onClose?: () => void; locked?: boolean }) {
  const { t } = useLanguage();
  const account = useAccount();
  const user = account.user;
  const needsPassword = !!user && user.user_metadata?.fillout_password_account !== true;
  const [mode, setMode] = useState<'profile' | 'login' | 'code' | 'delete'>(locked ? 'login' : 'profile');
  const [email, setEmail] = useState(user ? user.email || '' : locked ? '' : account.guest?.email || '');
  const [phone, setPhone] = useState(user ? user.user_metadata?.phone || '' : locked ? '' : account.guest?.phone || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [deletionVerified, setDeletionVerified] = useState(false);
  const [deletionCodeSent, setDeletionCodeSent] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => {
    generation.current++;
    setPassword(''); setConfirm(''); setCurrentPassword(''); setCode(''); setError(''); setSentTo(''); setSuccess('');
    setDeletionVerified(false); setDeletionCodeSent(false); setDeleteConfirmation('');
    if (user) {
      setMode('profile'); setEmail(user.email || ''); setPhone(user.user_metadata?.phone || '');
    } else {
      setEmail(locked ? '' : account.guest?.email || ''); setPhone(locked ? '' : account.guest?.phone || '');
      setMode(locked ? 'login' : 'profile');
    }
  }, [user?.id, locked]);
  useEffect(() => {
    if (user) { setEmail(user.email || ''); setPhone(user.user_metadata?.phone || ''); }
  }, [user?.email, user?.user_metadata?.phone]);

  async function run(action: (current: () => boolean) => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setSuccess('');
    const current = generation.current;
    try { await action(() => mounted.current && current === generation.current); }
    catch (cause) { if (mounted.current && current === generation.current) setError(cause instanceof Error ? cause.message : 'Please try again.'); }
    finally { if (mounted.current) { pending.current = false; setBusy(false); } }
  }
  function changeMode(next: typeof mode) {
    if (busy) return;
    setMode(next); setError(''); setSuccess(''); setPassword(''); setConfirm(''); setCurrentPassword(''); setCode('');
  }
  function validateProfile() {
    if (!email.trim()) throw new Error('Enter your email address.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Enter a valid email address.');
    if (!phone.trim()) throw new Error('Enter your phone number.');
    if (!/^\+?[\d\s().-]+$/.test(phone.trim()) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15) {
      throw new Error('Enter a valid phone number, including its country code if needed.');
    }
  }
  function validatePassword() {
    if (!password) throw new Error('Enter a password.');
    if (password !== confirm) throw new Error('Passwords do not match.');
  }
  const passwordFields = <>
    <Field label={t('New password')} value={password} onChangeText={setPassword} secureTextEntry editable={!busy} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" help={t('Your password is never saved on this device.')} />
    <Field label={t('Confirm password')} value={confirm} onChangeText={setConfirm} secureTextEntry editable={!busy} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" />
  </>;
  const deletionEmail = account.deletionEmail || user?.email;
  const deleting = mode === 'delete' || account.deletionPending;
  const unavailable = !cloudConfigured && <Notice tone="warning">{t(cloudConfigurationError || 'Account sign-in is not connected in this build. Please try again later.')}</Notice>;

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>{t(user ? 'My account' : mode === 'profile' || mode === 'delete' ? 'Your profile' : 'Login')}</Text>
      {!locked && !account.deletionPending && onClose && <Button title={t('Close')} variant="quiet" disabled={busy} onPress={onClose} />}
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {locked && <Text style={styles.copy}>{t('Sign in to continue. Your saved applications stay with your account.')}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
      {!!success && <Text accessibilityLiveRegion="polite" style={styles.success}>{t(success)}</Text>}
      {account.deletionPending && !!account.error && !error && <Text accessibilityRole="alert" style={styles.error}>{t(account.error)}</Text>}
      {deleting && <>
        <Text accessibilityRole="header" style={styles.subtitle}>{t(user || account.deletionEmail ? 'Delete account and data' : 'Delete local profile and data')}</Text>
        <Notice tone="warning">{t(user || account.deletionPending
          ? 'This permanently deletes your account, profile, requests, support messages and usage records from our active services, plus your drafts on this device. You cannot undo this. Copies you exported or saved on other devices are not removed.'
          : 'This permanently deletes your guest profile and all saved drafts on this device. You cannot undo this. Copies you exported are not removed.')}</Notice>
        {account.deletionPending && <Text style={styles.copy}>{t('Deletion is in progress. Retry to confirm the server result and finish removing data from this device. Your forms stay locked until cleanup is complete.')}</Text>}
        {deletionEmail && !deletionVerified && <>
          <Text style={styles.copy}>{t('For your security, verify your email before deleting your account.')}</Text>
          <Button title={t(deletionCodeSent ? 'Send a new deletion code' : 'Email me a deletion code')} disabled={busy} variant="secondary" onPress={() => void run(async current => {
            await requestSignInCode(deletionEmail); if (current()) { setDeletionCodeSent(true); setCode(''); }
          })} />
          {deletionCodeSent && <>
            <Field label={t('Email verification code')} value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 8))} editable={!busy} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={8} />
            <Button title={t('Verify email for deletion')} disabled={busy || code.length !== 8} onPress={() => void run(async current => {
              await verifyEmailCode(deletionEmail, code); if (current()) { setDeletionVerified(true); setCode(''); }
            })} />
          </>}
        </>}
        {!account.deletionPending && <Field label={t('Type DELETE to confirm')} value={deleteConfirmation} onChangeText={setDeleteConfirmation} editable={!busy} autoCapitalize="characters" autoCorrect={false} maxLength={6} />}
        <Button title={t(busy ? 'Deleting…' : account.deletionPending ? 'Retry account deletion' : 'Permanently delete')} disabled={busy || (!account.deletionPending && (deleteConfirmation !== 'DELETE' || !!user && !deletionVerified))} variant="secondary" onPress={() => void run(async () => {
          await account.deleteAccount();
        })} />
        {!account.deletionPending && <Button title={t('Cancel')} disabled={busy} variant="quiet" onPress={() => { setDeleteConfirmation(''); setDeletionVerified(false); setDeletionCodeSent(false); changeMode('profile'); }} />}
      </>}
      {!deleting && mode === 'profile' && <>
        <Text style={styles.copy}>{t(user ? 'Manage your personal details and sign-in.' : 'Your guest drafts will move to your account on this device. After signing out, you will need to log in to use the app.')}</Text>
        {needsPassword && <Notice>{t('Your email is confirmed. Set a password below to sign in with your email and password next time.')}</Notice>}
        <Field label={t(user ? 'Login email (required)' : 'Email (required)')} value={email} onChangeText={setEmail} editable={!busy && !user} maxLength={254} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" />
        <Field label={t('Phone (required)')} value={phone} onChangeText={setPhone} editable={!busy} maxLength={40} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
        {user ? <>
          <Button title={t(busy ? 'Saving…' : 'Save profile')} disabled={busy} onPress={() => void run(async current => {
            validateProfile(); await saveCloudProfile({ phone });
            if (current()) setSuccess('Your profile has been saved.');
          })} />
          <View style={styles.divider} />
          <Text accessibilityRole="header" style={styles.subtitle}>{t(needsPassword ? 'Create password' : 'Change password')}</Text>
          {passwordFields}
          <Button title={t(needsPassword ? 'Set password' : 'Update password')} disabled={busy || !password || !confirm} variant="secondary" onPress={() => void run(async current => {
            validatePassword(); await changeCloudPassword(password);
            if (current()) { setPassword(''); setConfirm(''); setSuccess(needsPassword ? 'Your password is ready. Use your email and password to sign in.' : 'Your password has been updated.'); }
          })} />
          <View style={styles.divider} />
          <Text accessibilityRole="header" style={styles.subtitle}>{t('Change login email')}</Text>
          <Field label={t('New email address')} value={sentTo} onChangeText={setSentTo} editable={!busy} maxLength={254} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
          <Field label={t('Current password')} value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry editable={!busy} autoCapitalize="none" autoCorrect={false} autoComplete="current-password" />
          <Button title={t('Update email')} disabled={busy || !sentTo.trim() || !currentPassword} variant="secondary" onPress={() => void run(async current => {
            const pendingConfirmation = await requestCloudEmailChange(sentTo, currentPassword);
            if (current()) { setCurrentPassword(''); setSuccess(pendingConfirmation ? 'Confirm the email change using the messages sent to your old and new email addresses, then refresh your profile.' : 'Your email has been updated.'); }
          })} />
          <Button title={t('Refresh profile')} disabled={busy} variant="quiet" onPress={() => void run(async current => { await refreshCloudUser(); if (current()) setSuccess('Your profile is up to date.'); })} />
          <Text style={styles.copy}>{t('You stay signed in on this device until you sign out. Your saved drafts are stored on this device under your account.')}</Text>
          <Button title={t('Sign out')} disabled={busy} variant="secondary" onPress={() => void run(account.signOut)} />
        </> : <>
          {passwordFields}{unavailable}
          <Button title={t(busy ? 'Please wait…' : 'Create account')} disabled={busy || !cloudConfigured} onPress={() => void run(async current => {
            validateProfile(); validatePassword(); await waitForDraftSaves();
            if (!current()) return;
            await account.saveGuest({ name: account.guest?.name || '', email: email.trim().toLowerCase(), phone: phone.trim() });
            if (!current()) return;
            const result = await signUpWithPassword({ email, phone }, password);
            if (current()) { setPassword(''); setConfirm(''); if (result.confirmationRequired) { setSentTo(result.email); setMode('code'); setSuccess(result.passwordSetupRequired ? 'Check your email to confirm your account. After verification, set a password in your profile.' : 'Check your email to confirm your account.'); } }
          })} />
          <Button title={t('Already have an account? Log in')} disabled={busy || !cloudConfigured} variant="secondary" onPress={() => changeMode('login')} />
        </>}
        <View style={styles.divider} />
        <Button title={t(user ? 'Delete account and data' : 'Delete local profile and data')} disabled={busy} variant="quiet" onPress={() => changeMode('delete')} />
      </>}
      {!deleting && mode === 'login' && <>
        <Field label={t('Login email')} value={email} onChangeText={setEmail} editable={!busy} maxLength={254} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="username" />
        <Field label={t('Password')} value={password} onChangeText={setPassword} secureTextEntry editable={!busy} autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" />
        {unavailable}
        <Button title={t(busy ? 'Signing in…' : 'Log in')} disabled={busy || !cloudConfigured} onPress={() => void run(async current => { if (!locked) await waitForDraftSaves(); if (current()) await signInWithPassword(email, password); })} />
        <Button title={t('Forgot password? Email me a code')} disabled={busy || !cloudConfigured} variant="secondary" onPress={() => void run(async current => {
          await requestSignInCode(email); if (current()) { setSentTo(email.trim().toLowerCase()); setPassword(''); setMode('code'); setSuccess('If an account exists, a sign-in code has been sent.'); }
        })} />
        {!locked && <Button title={t('Back to profile')} disabled={busy} variant="quiet" onPress={() => changeMode('profile')} />}
      </>}
      {!deleting && mode === 'code' && <>
        <Text style={styles.copy}>{t('Enter the eight-digit code sent to {email}.', { email: sentTo })}</Text>
        <Field label={t('Email verification code')} value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 8))} editable={!busy} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={8} />
        <Button title={t('Verify email')} disabled={busy || code.length !== 8 || !cloudConfigured} onPress={() => void run(async current => { if (!locked) await waitForDraftSaves(); if (current()) await verifyEmailCode(sentTo, code); })} />
        <Button title={t('Send a new code')} disabled={busy || !cloudConfigured} variant="secondary" onPress={() => void run(async current => { await requestSignInCode(sentTo); if (current()) setSuccess('If an account exists, a sign-in code has been sent.'); })} />
        <Button title={t('Back to login')} disabled={busy} variant="quiet" onPress={() => changeMode('login')} />
      </>}
    </ScrollView>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: colors.paper, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { flex: 1, fontSize: 25, fontWeight: '800', color: colors.navy },
  content: { padding: 20, gap: 16, paddingBottom: 32 },
  copy: { fontSize: 14, lineHeight: 21, color: colors.muted },
  subtitle: { fontSize: 18, fontWeight: '700', color: colors.navy },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  error: { fontSize: 14, lineHeight: 21, color: colors.error },
  success: { fontSize: 14, lineHeight: 21, color: colors.success },
});
