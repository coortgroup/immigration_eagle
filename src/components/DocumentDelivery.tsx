import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius } from '../theme';
import { Button, Card } from './UI';
import {
  createMailingRequest,
  DocumentDeliveryChoice,
  DocumentDeliveryState,
  getDocumentDeliveryStatus,
  initialDocumentDeliveryState,
  MailingConfiguration,
  MailingRequest,
} from '../documentDelivery';

export type DocumentDeliveryProps = {
  formId: string;
  pdfReady: boolean;
  /** Change when a newly generated PDF replaces the reviewed document. */
  documentRevision?: string;
  pdfUnavailableReason?: string;
  onDownloadPdf?: () => void | Promise<void>;
  onPrintPdf?: () => void | Promise<void>;
  onSharePdf?: () => void | Promise<void>;
  mailing?: MailingConfiguration;
  /** Opens/sends the explicitly reviewed mailing request; never grants paid fulfillment. */
  onRequestMailing?: (request: MailingRequest) => void | Promise<void>;
};

export function DocumentDelivery({ formId, pdfReady, documentRevision, pdfUnavailableReason, onDownloadPdf, onPrintPdf, onSharePdf, mailing, onRequestMailing }: DocumentDeliveryProps) {
  const [state, setState] = useState<DocumentDeliveryState>(initialDocumentDeliveryState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // An edited document or changed quote must be reviewed and authorized again.
  useEffect(() => {
    setState(initialDocumentDeliveryState);
    setError('');
  }, [formId, documentRevision, pdfReady, mailing?.quote?.id, mailing?.quote?.amountMinor, mailing?.quote?.currency, mailing?.destination]);
  const statusInput = { pdfReady, mailing, state, hasRequestHandler: !!onRequestMailing, busy };
  const status = getDocumentDeliveryStatus(statusInput);

  function select(choice: DocumentDeliveryChoice) {
    setState(current => ({ ...current, choice, consent: false }));
    setError('');
  }

  async function perform(action?: () => void | Promise<void>) {
    if (!action || !pdfReady || busy) return;
    setBusy(true);
    setError('');
    try { await action(); }
    catch { setError('The document could not be opened. Please try again.'); }
    finally { setBusy(false); }
  }

  async function requestMailing() {
    const request = createMailingRequest({ ...statusInput, formId });
    if (!request || !onRequestMailing) return;
    setBusy(true);
    setError('');
    try {
      await onRequestMailing(request);
      setState(current => ({ ...current, consent: false }));
    } catch {
      setError('Your mailing request could not be completed. Please try again.');
    } finally { setBusy(false); }
  }

  return <View style={styles.container}>
    <Card>
      <View style={styles.documentHeading}>
        <View style={styles.documentIcon}><Ionicons name="document-text-outline" size={24} color={colors.navy} /></View>
        <View style={styles.headingText}>
          <Text accessibilityRole="header" style={styles.title}>{pdfReady ? `${formId} · Your filled official form` : `${formId} · Your final document`}</Text>
          <Text style={styles.body}>{pdfReady ? 'Review the PDF, then print it for signature.' : pdfUnavailableReason || 'Complete the questionnaire and review your answers to generate your filled official PDF.'}</Text>
        </View>
      </View>
      <Button title="Download filled PDF" icon="download-outline" disabled={!pdfReady || !onDownloadPdf || busy} onPress={() => void perform(onDownloadPdf)} />
      {(onPrintPdf || onSharePdf) && <View style={styles.actions}>
        {onPrintPdf && <Button title={Platform.OS === 'web' ? 'Open PDF to print' : 'Print'} variant="secondary" icon="print-outline" disabled={!pdfReady || busy} style={styles.action} onPress={() => void perform(onPrintPdf)} />}
        {onSharePdf && <Button title="Save or share" variant="secondary" icon="share-outline" disabled={!pdfReady || busy} style={styles.action} onPress={() => void perform(onSharePdf)} />}
      </View>}
    </Card>

    <Text accessibilityRole="header" style={styles.title}>How would you like to send it?</Text>
    <Choice title="I’ll sign and mail it myself" subtitle="Download and print your form. No FILLOUT mailing charge." icon="print-outline" selected={state.choice === 'self'} disabled={busy} onPress={() => select('self')} />
    <Choice title="Use FILLOUT mailing" subtitle={status.priceLabel} icon="mail-outline" selected={state.choice === 'mailing'} disabled={busy} onPress={() => select('mailing')} />

    {state.choice === 'self' ? <View style={styles.steps}>
      <Step number="1" text="Review your completed form and print it." />
      <Step number="2" text="Sign where required and gather the supporting documents." />
      <Step number="3" text="Follow the form’s filing instructions for the address and any government fee." />
    </View> : <Card>
      <Text accessibilityRole="header" style={styles.title}>Review the mailing service</Text>
      <View style={styles.summaryRow}><Text style={styles.body}>Form</Text><Text style={styles.value}>{formId}</Text></View>
      <View style={styles.summaryRow}><Text style={styles.body}>Mailing service</Text><Text style={styles.value}>{status.priceLabel}</Text></View>
      <Text style={styles.body}>{status.destinationLabel}</Text>
      <Text style={styles.caption}>Mailing is an additional service. Government filing fees are separate.</Text>
      {status.destination === 'applicant' && <Text style={styles.body}>We mail the printed form to you. You review, sign and send the packet using the form’s filing instructions.</Text>}
      {status.needsSignature && <Text style={styles.body}>Review and sign your packet before handing it to our team for mailing.</Text>}
      <Check label="I have reviewed my completed form." checked={state.reviewed} disabled={!pdfReady || busy} onPress={() => setState(current => ({ ...current, reviewed: !current.reviewed, consent: false }))} />
      {status.needsSignature && <Check label="I have signed my packet where required." checked={state.signedPacketConfirmed} disabled={!pdfReady || busy} onPress={() => setState(current => ({ ...current, signedPacketConfirmed: !current.signedPacketConfirmed, consent: false }))} />}
      {mailing?.requestAvailable && status.price && status.destination && onRequestMailing && <Check label="Send this mailing request to FILLOUT. I understand mailing has an additional charge." checked={state.consent} disabled={!pdfReady || !state.reviewed || (status.needsSignature && !state.signedPacketConfirmed) || busy} onPress={() => setState(current => ({ ...current, consent: !current.consent }))} />}
      <Button title={busy ? 'Please wait…' : 'Request mailing service'} icon="mail-outline" disabled={!status.canRequestMailing} onPress={() => void requestMailing()} />
      {!!status.blockedReason && <Text style={styles.caption}>{status.blockedReason}</Text>}
    </Card>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}

function Choice({ title, subtitle, icon, selected, disabled, onPress }: { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; selected: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.choice, selected && styles.selected, disabled && styles.disabled, pressed && { opacity: 0.8 }]}>
    <Ionicons name={icon} size={23} color={colors.navy} />
    <View style={styles.headingText}><Text style={styles.choiceTitle}>{title}</Text><Text style={styles.caption}>{subtitle}</Text></View>
    <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={colors.navy} />
  </Pressable>;
}

function Check({ label, checked, disabled, onPress }: { label: string; checked: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress} style={[styles.check, disabled && styles.disabled]}>
    <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={23} color={colors.navy} />
    <Text style={[styles.body, styles.headingText]}>{label}</Text>
  </Pressable>;
}

function Step({ number, text }: { number: string; text: string }) {
  return <View style={styles.step}><Text style={styles.stepNumber}>{number}</Text><Text style={[styles.body, styles.headingText]}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  documentHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  documentIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.blueLight, alignItems: 'center', justifyContent: 'center' },
  headingText: { flex: 1, gap: 4 },
  title: { color: colors.navy, fontSize: 18, lineHeight: 25, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  caption: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { flexGrow: 1, flexBasis: 130 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.paper, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: 14 },
  choiceTitle: { color: colors.navy, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  selected: { borderColor: colors.navy, backgroundColor: colors.blueLight },
  disabled: { opacity: 0.5 },
  steps: { gap: 10, paddingHorizontal: 3, paddingVertical: 4 },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.blueLight, color: colors.navy, textAlign: 'center', lineHeight: 24, fontSize: 12, fontWeight: '800' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  value: { flexShrink: 1, color: colors.text, fontSize: 14, lineHeight: 21, fontWeight: '700', textAlign: 'right' },
  check: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  error: { color: colors.error, fontSize: 13, lineHeight: 20 },
});
