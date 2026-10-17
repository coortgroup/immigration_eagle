import React, { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCloudSession } from '../cloudClient';
import { useLanguage } from '../LanguageContext';
import { colors } from '../theme';
import { Badge, BrandMark, Button, Card, Notice, SectionTitle } from './UI';
import { isPaymentTestBuild, reconcilePayment, loadPaymentProduct, purchaseAiPreparation, restoreAiPurchases, type PaymentProduct } from '../payments';

type Props = {
  formId: string; caseId?: string; parentCaseId?: string; isActive: boolean;
  onBack: () => void; onAccount?: () => void; onContact: () => void;
  onRecoverCase: (caseId: string) => Promise<void>;
  applicationReturnRequest?: number; onReturnToApplications?: () => void;
  children: React.ReactNode;
};

/** Only the authenticated server can open the paid questionnaire. Never persist access locally. */
export function AiPaymentGate({ formId, caseId, parentCaseId, isActive, onBack, onAccount, onContact, onRecoverCase, applicationReturnRequest, onReturnToApplications, children }: Props) {
  const { t } = useLanguage();
  const session = useCloudSession();
  const userId = session.user?.id;
  const [grantedTo, setGrantedTo] = useState<string>();
  const [paymentEnvironment, setPaymentEnvironment] = useState<'production' | 'sandbox'>();
  const [product, setProduct] = useState<PaymentProduct>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState('');
  const [recoverCaseId, setRecoverCaseId] = useState<string>();
  const generation = useRef(0);
  const inFlight = useRef(false);
  const handledReturn = useRef(applicationReturnRequest);
  const identity = `${userId || ''}:${caseId || ''}:${formId}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  const granted = !!userId && !!caseId && grantedTo === identity;

  async function run(action: 'check' | 'purchase' | 'restore') {
    if (inFlight.current || !userId || !caseId) return;
    const request = ++generation.current;
    const expected = identity;
    const input = { userId, caseId, formId, ...(parentCaseId ? { parentCaseId } : {}) };
    inFlight.current = true; setBusy(true); setError('');
    const current = () => request === generation.current && identityRef.current === expected;
    try {
      const status = action === 'purchase' && product ? await purchaseAiPreparation(input, product)
        : action === 'restore' ? await restoreAiPurchases(input) : await reconcilePayment(input);
      if (!current()) return;
      setPaymentEnvironment(status.environment);
      setRecoverCaseId(status.recoverCaseId);
      if (status.access === 'granted') { setGrantedTo(expected); setPending(false); return; }
      setGrantedTo(undefined);
      setUnavailable(status.access === 'unavailable');
      const purchaseState = 'purchaseState' in status ? status.purchaseState : undefined;
      setPending(purchaseState === 'pending');
      if (purchaseState === 'cancelled') setError('Payment was cancelled. You have not unlocked AI preparation.');
      if (status.access === 'payment_required' && status.productId && !status.recoverCaseId) {
        const loaded = await loadPaymentProduct(input, status.productId);
        if (current()) setProduct(loaded);
      } else setProduct(undefined);
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : 'Payment could not be checked. Please try again.');
    } finally { if (current()) { inFlight.current = false; setBusy(false); } }
  }

  useEffect(() => {
    generation.current += 1; inFlight.current = false;
    setGrantedTo(undefined); setPaymentEnvironment(undefined); setProduct(undefined); setPending(false); setUnavailable(false); setBusy(false); setError(''); setRecoverCaseId(undefined);
    if (userId && caseId) void run('check');
    return () => { generation.current += 1; inFlight.current = false; };
  }, [identity, parentCaseId]);
  useEffect(() => {
    if (!isActive) return;
    if (granted) void run('check');
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') void run('check'); });
    return () => subscription.remove();
  }, [isActive, identity, parentCaseId]);
  useEffect(() => {
    if (!isActive || granted) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { if (!inFlight.current) onBack(); return true; });
    return () => subscription.remove();
  }, [isActive, granted, onBack]);
  useEffect(() => {
    if (handledReturn.current === applicationReturnRequest) return;
    if (busy) return;
    handledReturn.current = applicationReturnRequest;
    if (!granted) onReturnToApplications?.();
  }, [applicationReturnRequest, busy, granted, onReturnToApplications]);

  const sandboxNotice = <Notice title={t('Test payment environment')}>{t('Sample information only. This test application is not a request for a paid service.')}</Notice>;
  if (granted) return paymentEnvironment === 'sandbox'
    ? <View style={styles.testContent}><View style={styles.testNotice}>{sandboxNotice}</View>{children}</View>
    : <>{children}</>;
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Button title={t('Back to form check')} variant="quiet" icon="arrow-back" disabled={busy} onPress={onBack} />
    {(isPaymentTestBuild || paymentEnvironment === 'sandbox') && sandboxNotice}
    <View style={styles.hero}>
      <View style={styles.heroHeading}><BrandMark compact /><Badge>{formId}</Badge></View>
      <Ionicons name="sparkles-outline" size={34} color={colors.gold} />
      <Text accessibilityRole="header" style={styles.heroTitle}>{t('Your next step: prepare with AI')}</Text>
      <Text style={styles.heroBody}>{t('Your preliminary check is complete. Confirm a one-time payment to start this application.')}</Text>
    </View>
    <Card>
      <SectionTitle title={t('One application. One payment.')} />
      {['Guided questions for your selected form', 'Save your progress and return to this application', 'FillOut team review before PDF download'].map(label => <View key={label} style={styles.feature}><Ionicons name="checkmark-circle" color={colors.navyLight} size={21} /><Text style={styles.body}>{t(label)}</Text></View>)}
      <View style={styles.total}><Text style={styles.label}>{t('AI preparation')}</Text><Text style={styles.price}>{product?.priceString || t('Price confirmed by the store')}</Text></View>
      <Text style={styles.caption}>{t('This payment covers one application. Reopening this same application does not require another payment. Government filing fees are separate.')}</Text>
    </Card>
    {!caseId && <Notice tone="warning">{t('Save this application before continuing to payment.')}</Notice>}
    {!userId ? <>
      <Notice>{t('Sign in to link your purchase to your account and this application.')}</Notice>
      {onAccount && <Button title={t('Sign in to continue')} icon="person-outline" onPress={onAccount} />}
    </> : <>
      {busy && <Notice>{t('Checking your purchase…')}</Notice>}
      {pending && <Notice title={t('Payment confirmation pending')}>{t('Do not pay again. Your purchase is being confirmed. Check payment to continue when confirmation arrives.')}</Notice>}
      {recoverCaseId ? <>
        <Notice tone="success">{t('You already have a paid application for this form. Restore its access without paying again. Your current saved answers stay on this device.')}</Notice>
        <Button title={t('Continue my paid application')} disabled={busy} onPress={() => {
          if (inFlight.current) return;
          inFlight.current = true; setBusy(true); setError('');
          void onRecoverCase(recoverCaseId).catch(reason => setError(reason instanceof Error ? reason.message : 'Save this application before continuing to payment.'))
            .finally(() => { inFlight.current = false; setBusy(false); });
        }} />
      </> : unavailable && <Notice>{t('AI payment is not available for this form yet. Your answers are saved; our team can help with the next step.')}</Notice>}
      {!!product && !pending && !unavailable && !recoverCaseId && <Button title={t('Pay {price} and start', { price: product.priceString })} disabled={busy} icon="lock-closed-outline" onPress={() => void run('purchase')} />}
      <Button title={t('Check payment')} variant="secondary" disabled={busy || !caseId} icon="refresh-outline" onPress={() => void run('check')} />
      {Platform.OS !== 'web' && <Button title={t('Restore purchases')} variant="quiet" disabled={busy || !caseId} onPress={() => void run('restore')} />}
    </>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
    <Text style={styles.caption}>{t('You confirm the purchase in the store. The questionnaire opens only after payment is verified.')}</Text>
    <Button title={t('Chat with our team')} variant="quiet" icon="chatbubble-ellipses-outline" disabled={busy} onPress={onContact} />
  </ScrollView>;
}

const styles = StyleSheet.create({
  testContent: { flex: 1 },
  testNotice: { paddingHorizontal: 20, paddingTop: 12 },
  content: { padding: 20, paddingBottom: 40, gap: 16, width: '100%', maxWidth: 600, alignSelf: 'center' },
  hero: { padding: 24, borderRadius: 26, backgroundColor: colors.navy, gap: 14 },
  heroHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroTitle: { color: colors.paper, fontSize: 29, lineHeight: 35, fontWeight: '800' },
  heroBody: { color: '#E4EDFF', fontSize: 15, lineHeight: 23 },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  body: { color: colors.text, fontSize: 15, lineHeight: 23, flex: 1 },
  label: { color: colors.navy, fontSize: 15, fontWeight: '700' },
  total: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 18, gap: 10 },
  price: { color: colors.navy, fontSize: 28, fontWeight: '800' },
  caption: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  error: { color: colors.error, fontSize: 14, lineHeight: 21 },
});
