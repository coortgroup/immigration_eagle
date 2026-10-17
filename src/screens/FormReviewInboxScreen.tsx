import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLanguage } from '../LanguageContext';
import { decideReview, downloadReviewDocument, listReviewInbox, type ReviewCursor, type ReviewEnvironment, type ReviewSubmission } from '../formReview';
import type { PrintableDocument } from '../officialPdfDocument';

const statusText: Record<ReviewSubmission['status'], string> = {
  pending: 'Waiting for review', approved: 'Approved for download', changes_requested: 'Changes requested', superseded: 'Replaced by a newer submission',
};

function Action({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.action, secondary && styles.secondaryAction, disabled && styles.disabled]}>
    <Text style={[styles.actionText, secondary && styles.secondaryText]}>{title}</Text>
  </Pressable>;
}

function ReviewDetail({ submission, isActive, onBack, onChanged }: {
  submission: ReviewSubmission; isActive: boolean; onBack: () => void; onChanged: (submission: ReviewSubmission) => void;
}) {
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [opened, setOpened] = useState(false);
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState<'approved' | 'changes_requested' | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const document = useRef<PrintableDocument | null>(null);
  const version = useRef(0), openingRef = useRef(false), savingRef = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = useRef(isActive); active.current = isActive;
  const current = useRef(submission); current.current = submission;
  const pending = submission.status === 'pending';
  const date = new Date(submission.submittedAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US');

  useEffect(() => {
    const request = ++version.current;
    document.current?.dispose(); document.current = null;
    setReady(false); setOpened(false); setOpening(false); openingRef.current = false;
    setConfirming(null); setError(''); setLoading(isActive);
    if (isActive) void downloadReviewDocument(submission).then(pdf => {
      if (version.current !== request || !active.current) { pdf.dispose(); return; }
      document.current = pdf; setReady(true);
    }).catch(failure => {
      if (version.current === request && active.current) setError(failure instanceof Error ? failure.message : 'The submitted PDF could not be loaded. Please try again.');
    }).finally(() => { if (version.current === request && active.current) setLoading(false); });
    return () => { ++version.current; document.current?.dispose(); document.current = null; };
  }, [submission.id, submission.environment, submission.caseId, submission.sha256, isActive, reload]);

  async function open(kind: 'open' | 'download') {
    const pdf = document.current, request = version.current;
    if (!pdf || !active.current || openingRef.current || savingRef.current) return;
    openingRef.current = true; setOpening(true); setError('');
    try {
      if (kind === 'open' && pdf.print) await pdf.print(); else await pdf.download();
      if (request === version.current && active.current) setOpened(true);
    } catch (failure) {
      if (request === version.current && active.current) setError(failure instanceof Error ? failure.message : 'The submitted PDF could not be opened. Please try again.');
    } finally {
      if (request === version.current) { openingRef.current = false; setOpening(false); }
    }
  }

  async function confirm() {
    const decision = confirming;
    if (!decision || savingRef.current || openingRef.current || !active.current || current.current.status !== 'pending') return;
    if (decision === 'approved' && (!opened || !document.current)) return;
    if (decision === 'changes_requested' && !note.trim()) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const updated = await decideReview(submission.id, decision, note.trim(), submission.environment);
      if (!mounted.current || current.current.id !== submission.id || current.current.environment !== submission.environment) return;
      setConfirming(null); setNote(''); onChanged(updated);
    } catch (failure) {
      if (mounted.current && current.current.id === submission.id && current.current.environment === submission.environment) setError(failure instanceof Error ? failure.message : 'The review decision was not confirmed. Refresh the submission before trying again.');
    } finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  }

  const busy = saving || opening;
  return <View style={styles.screen}>
    <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>{submission.formId}</Text>
      <Action title={t('Forms for review')} onPress={onBack} disabled={saving} secondary /></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text selectable style={styles.email}>{submission.email || t('Client')}</Text>
        <Text style={styles.badge}>{t(submission.environment === 'sandbox' ? 'Test submission' : 'Production reviews')}</Text>
        {submission.environment === 'sandbox' && <Text style={styles.label}>{t('Sample information only. This form is for testing and must not be filed.')}</Text>}
        <Text style={styles.badge}>{t(statusText[submission.status])}</Text>
        <Text style={styles.body}>{t('Submitted {date}', { date })}</Text>
        <Text selectable style={styles.meta}>{t('Version {version}', { version: submission.id })}</Text>
        <Text style={styles.body}>{t(submission.environment === 'sandbox' ? 'Test review only. Approval does not make this form ready for filing.' : 'Review the exact PDF submitted by this client. Approval releases this version for download and printing.')}</Text>
        {loading ? <Text style={styles.note}>{t('Loading submitted PDF…')}</Text> : ready ? <View style={styles.actions}>
          <Action title={t(Platform.OS === 'web' ? 'Open submitted PDF' : 'Preview submitted PDF')} onPress={() => void open('open')} disabled={busy || !isActive} />
          <Action title={t('Download for review')} onPress={() => void open('download')} disabled={busy || !isActive} secondary />
        </View> : <Action title={t('Load submitted PDF')} onPress={() => setReload(value => value + 1)} disabled={!isActive || busy} secondary />}
      </View>
      {!!submission.reviewNote && <View style={styles.card}><Text style={styles.label}>{t('Review note')}</Text><Text selectable style={styles.body}>{submission.reviewNote}</Text></View>}
      {pending && <View style={styles.card}>
        <Text style={styles.label}>{t('Your review')}</Text>
        <Text style={styles.body}>{t('Approve the form when your review is complete, or explain what the client needs to correct.')}</Text>
        <TextInput accessibilityLabel={t('Review note for client')} placeholder={t('Corrections or a note for the client…')} placeholderTextColor="#667085"
          value={note} onChangeText={value => { setNote(value); setConfirming(null); }} editable={!saving} multiline maxLength={2000} textAlignVertical="top" style={styles.input} />
        {!opened && <Text style={styles.note}>{t('Open or download this PDF before approving it.')}</Text>}
        <View style={styles.actions}>
          <Action title={t('Approve this version')} onPress={() => setConfirming('approved')} disabled={!opened || !ready || busy || !isActive} />
          <Action title={t('Request changes')} onPress={() => setConfirming('changes_requested')} disabled={!note.trim() || busy || !isActive} secondary />
        </View>
        {confirming && <View style={styles.confirmation}>
          <Text style={styles.label}>{t(confirming === 'approved' ? submission.environment === 'sandbox' ? 'Confirm test approval' : 'Confirm approval' : 'Confirm change request')}</Text>
          {submission.environment === 'sandbox' && <Text style={styles.body}>{t('Test review only. Approval does not make this form ready for filing.')}</Text>}
          <Text style={styles.body}>{t(confirming === 'approved'
            ? 'I have reviewed {formId}, submitted {date}. Approving makes this PDF available to the client for download and printing.'
            : 'Send this note to the client for {formId}, submitted {date}. The PDF stays unavailable until a corrected submission is approved.', { formId: submission.formId, date })}</Text>
          <View style={styles.actions}>
            <Action title={t(saving ? 'Saving decision…' : confirming === 'approved' ? 'Confirm and approve' : 'Send change request')} onPress={() => void confirm()} disabled={busy || !isActive} />
            <Action title={t('Cancel')} onPress={() => setConfirming(null)} disabled={saving} secondary />
          </View>
        </View>}
      </View>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
    </ScrollView>
  </View>;
}

export function FormReviewInboxScreen({ isActive, onClose }: { isActive: boolean; onClose: () => void }) {
  const { t, language } = useLanguage();
  const [submissions, setSubmissions] = useState<ReviewSubmission[]>([]);
  const [environment, setEnvironment] = useState<ReviewEnvironment>('production');
  const [selected, setSelected] = useState<ReviewSubmission | null>(null);
  const [older, setOlder] = useState<ReviewCursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false), mounted = useRef(true), sequence = useRef(0);
  const active = useRef(isActive); active.current = isActive;
  const environmentRef = useRef(environment); environmentRef.current = environment;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++sequence.current; }; }, []);
  async function refresh(before?: ReviewCursor) {
    if (busy.current || !active.current) return;
    const request = ++sequence.current;
    const requestedEnvironment = environmentRef.current;
    busy.current = true; setLoading(true); setError('');
    try {
      const result = await listReviewInbox(before, requestedEnvironment);
      if (!mounted.current || !active.current || sequence.current !== request || environmentRef.current !== requestedEnvironment) return;
      setSubmissions(previous => {
        const all = new Map((before ? previous : []).map(item => [item.id, item]));
        result.submissions.forEach(item => all.set(item.id, item));
        return [...all.values()].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt) || b.id.localeCompare(a.id));
      });
      setOlder(result.nextBefore);
    } catch (failure) {
      if (mounted.current && active.current && sequence.current === request) setError(failure instanceof Error ? failure.message : 'Forms for review could not be loaded. Please try again.');
    } finally { if (sequence.current === request) { busy.current = false; if (mounted.current) setLoading(false); } }
  }
  function switchEnvironment(next: ReviewEnvironment) {
    if (next === environmentRef.current) return;
    ++sequence.current; busy.current = false; environmentRef.current = next;
    setEnvironment(next); setSelected(null); setSubmissions([]); setOlder(null); setError(''); setLoading(false);
  }
  useEffect(() => {
    if (!isActive || selected) return;
    const update = () => { if (AppState.currentState === 'active' || AppState.currentState == null) void refresh(); };
    update(); const timer = setInterval(update, 30_000);
    const listener = AppState.addEventListener('change', next => { if (next === 'active') update(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, [isActive, selected, environment]);
  if (selected) return <ReviewDetail key={`${selected.environment}:${selected.id}`} submission={selected} isActive={isActive} onBack={() => setSelected(null)} onChanged={updated => {
    setSelected(updated); setSubmissions(items => items.map(item => item.id === updated.id ? updated : item));
  }} />;
  return <View style={styles.screen}>
    <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>{t('Forms for review')}</Text><Action title={t('My chat')} onPress={onClose} secondary /></View>
    <Text style={styles.body}>{t('Submitted FillOut forms wait here until your team completes its review.')}</Text>
    <View style={styles.actions}>
      <Action title={t('Production reviews')} onPress={() => switchEnvironment('production')} disabled={environment === 'production'} secondary={environment !== 'production'} />
      <Action title={t('Test reviews')} onPress={() => switchEnvironment('sandbox')} disabled={environment === 'sandbox'} secondary={environment !== 'sandbox'} />
    </View>
    {environment === 'sandbox' && <Text style={styles.label}>{t('Review test submissions separately from production work.')}</Text>}
    <View style={styles.refresh}><Action title={t('Refresh')} onPress={() => void refresh()} disabled={loading} secondary /></View>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
    <ScrollView contentContainerStyle={styles.content}>
      {!submissions.length && <Text style={styles.note}>{t(loading ? 'Loading forms for review…' : 'No submitted forms yet.')}</Text>}
      {submissions.map(submission => <Pressable key={submission.id} accessibilityRole="button" onPress={() => setSelected(submission)} style={styles.card}>
        {submission.environment === 'sandbox' && <Text style={styles.badge}>{t('Test submission')}</Text>}
        <View style={styles.row}><Text style={styles.formId}>{submission.formId}</Text><Text style={styles.badge}>{t(statusText[submission.status])}</Text></View>
        <Text numberOfLines={2} style={styles.email}>{submission.email || t('Client')}</Text>
        <Text style={styles.meta}>{t('Submitted {date}', { date: new Date(submission.submittedAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US') })}</Text>
      </Pressable>)}
      {older && <Action title={t('More submissions')} onPress={() => void refresh(older)} disabled={loading} secondary />}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, paddingHorizontal: 20 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, fontSize: 24, fontWeight: '800', color: '#092653' }, content: { gap: 12, paddingVertical: 12, paddingBottom: 24 },
  card: { backgroundColor: '#FFFFFF', borderColor: '#DCE3ED', borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, formId: { fontSize: 18, fontWeight: '800', color: '#092653' },
  email: { color: '#092653', fontSize: 14, fontWeight: '700' }, badge: { flexShrink: 1, color: '#806118', backgroundColor: '#FFF5D9', padding: 6, fontSize: 12, borderRadius: 5 },
  body: { color: '#253B5D', fontSize: 14, lineHeight: 21 }, note: { color: '#667085', fontSize: 13, lineHeight: 20 }, meta: { color: '#667085', fontSize: 11, lineHeight: 17 },
  label: { fontSize: 16, fontWeight: '700', color: '#092653' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#092653', borderRadius: 10 },
  actionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', textAlign: 'center' }, secondaryAction: { backgroundColor: '#EAF0F8' }, secondaryText: { color: '#092653' },
  disabled: { opacity: 0.4 }, input: { minHeight: 110, maxHeight: 210, padding: 12, borderColor: '#D6DFEC', borderWidth: 1, borderRadius: 12, color: '#092653', fontSize: 15, lineHeight: 22 },
  confirmation: { gap: 12, borderTopWidth: 1, borderTopColor: '#DCE3ED', paddingTop: 12 }, error: { color: '#A12336', fontSize: 13, lineHeight: 20 }, refresh: { alignItems: 'flex-end', marginTop: 8 },
});
