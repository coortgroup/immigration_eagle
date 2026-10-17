import React, { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useCloudSession } from '../cloudClient';
import { downloadReviewDocument, listMyReviews, type ReviewSubmission } from '../formReview';
import type { PrintableDocument } from '../officialPdfDocument';
import { localeFor } from '../i18n';
import { useLanguage } from '../LanguageContext';
import { Button, Card, Notice } from './UI';
import { DocumentDelivery } from './DocumentDelivery';
import { colors } from '../theme';

export function MyReviewSubmissions({ isActive, editableCases, onEdit }: {
  isActive: boolean; editableCases: {formId: string; caseId: string | null}[]; onEdit: (formId: string) => void;
}) {
  const { t, language } = useLanguage();
  const { user } = useCloudSession();
  const owner = user?.id;
  const [submissions, setSubmissions] = useState<ReviewSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string>();
  const [document, setDocument] = useState<{ submission: ReviewSubmission; file: PrintableDocument }>();
  const fileRef = useRef<typeof document>(undefined);
  const lifecycle = useRef(0);
  const request = useRef(0);
  const fetching = useRef(false);
  const openingRef = useRef(false);
  const openingSubmission = useRef<ReviewSubmission | undefined>(undefined);
  const fileRequest = useRef(0);

  function closeDocument() {
    fileRequest.current++; openingSubmission.current = undefined; openingRef.current = false; setOpening(undefined);
    fileRef.current?.file.dispose(); fileRef.current = undefined; setDocument(undefined);
  }
  async function refresh() {
    if (!owner || !isActive || fetching.current) return;
    const current = lifecycle.current;
    const revision = ++request.current;
    fetching.current = true; setLoading(true); setError('');
    try {
      const rows = await listMyReviews();
      if (current !== lifecycle.current || revision !== request.current) return;
      setSubmissions(rows);
      // A replacement submitted from another device must close an old copy.
      const open = fileRef.current?.submission || openingSubmission.current;
      if (open && !rows.some(row => row.id === open.id && row.environment === open.environment
        && row.caseId === open.caseId && row.status === 'approved' && row.sha256 === open.sha256)) closeDocument();
    } catch (cause) {
      if (current === lifecycle.current && revision === request.current) {
        closeDocument();
        setError(cause instanceof Error ? cause.message : 'The review status could not be loaded. Please try again.');
      }
    } finally {
      if (current === lifecycle.current && revision === request.current) { fetching.current = false; setLoading(false); }
    }
  }
  useEffect(() => {
    lifecycle.current++; request.current++; fetching.current = false; openingRef.current = false;
    closeDocument(); setSubmissions([]); setError(''); setOpening(undefined); setLoading(false);
    if (isActive && owner) void refresh();
    const timer = isActive && owner ? setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 30_000) : undefined;
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => {
      lifecycle.current++; request.current++; fileRequest.current++; fileRef.current?.file.dispose(); fileRef.current = undefined;
      if (timer) clearInterval(timer); subscription.remove();
    };
  }, [owner, isActive]);

  async function openApproved(submission: ReviewSubmission) {
    if (openingRef.current || submission.status !== 'approved' || !owner || !isActive) return;
    const current = lifecycle.current;
    closeDocument();
    const fileRevision = ++fileRequest.current;
    openingSubmission.current = submission; openingRef.current = true; setOpening(submission.id); setError('');
    try {
      const file = await downloadReviewDocument(submission);
      if (current !== lifecycle.current || fileRevision !== fileRequest.current) { file.dispose(); return; }
      const next = { submission, file };
      fileRef.current = next; setDocument(next);
    } catch (cause) {
      if (current === lifecycle.current && fileRevision === fileRequest.current) setError(cause instanceof Error ? cause.message : 'The reviewed PDF could not be opened. Please try again.');
    } finally {
      if (current === lifecycle.current && fileRevision === fileRequest.current) { openingSubmission.current = undefined; openingRef.current = false; setOpening(undefined); }
    }
  }

  if (!owner) return null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>{t('Forms sent to FillOut')}</Text>
    {loading && <Text style={styles.caption}>{t('Checking review status…')}</Text>}
    {!!error && <Notice tone="warning">{t(error)}</Notice>}
    {!loading && !error && !submissions.length && <Text style={styles.caption}>{t('After you finish the FillOut questions, send your form here for our team to review. Download and print become available after approval.')}</Text>}
    {submissions.map(row => <Card key={row.id}>
      {row.environment === 'sandbox' && <Notice title={t('Test submission')}>{t('Sample information only. This form is for testing and must not be filed.')}</Notice>}
      <Text style={styles.title}>{row.formId} · {t(row.status === 'approved' ? row.environment === 'sandbox' ? 'Test review approved' : 'Approved for download' : row.status === 'changes_requested' ? 'Changes requested' : 'Awaiting team review')}</Text>
      <Text style={styles.caption}>{t('Submitted {date}', { date: new Date(row.submittedAt).toLocaleString(localeFor(language)) })}</Text>
      {!!row.reviewNote && <><Text style={styles.label}>{t('Message from FillOut')}</Text><Text selectable style={styles.note}>{row.reviewNote}</Text></>}
      {row.status === 'pending' && <Text style={styles.caption}>{t('Your form is with our team. Download and print will appear after approval.')}</Text>}
      {row.status === 'changes_requested' && <Text style={styles.caption}>{t('Update your saved answers, then send a new version for review.')}</Text>}
      {row.status === 'approved' && <>
        <Text style={styles.caption}>{t(row.environment === 'sandbox' ? 'Test review only. Approval does not make this form ready for filing.' : 'Download the exact version approved by our team. Any new answers must be sent for another review.')}</Text>
        <Button title={t(opening === row.id ? 'Opening reviewed PDF…' : row.environment === 'sandbox' ? 'Open test PDF' : 'Open reviewed PDF')} disabled={!!opening || loading || !!error} onPress={() => void openApproved(row)} />
      </>}
      {editableCases.some(draft => draft.formId === row.formId && draft.caseId === row.caseId) && <Button title={t('Edit saved answers')} disabled={!!opening} variant="secondary" onPress={() => { closeDocument(); onEdit(row.formId); }} />}
      {row.status === 'changes_requested' && !editableCases.some(draft => draft.formId === row.formId && draft.caseId === row.caseId) && <Text style={styles.caption}>{t('Your editable draft is on the device where you filled it out. Open that draft to make the requested changes.')}</Text>}
      {document?.submission.id === row.id && <>
        <DocumentDelivery testDocument={row.environment === 'sandbox'} formId={row.formId} pdfReady documentRevision={row.id} onDownloadPdf={document.file.download} onPrintPdf={document.file.print} onSharePdf={document.file.share} />
        <Button title={t('Close PDF actions')} variant="quiet" onPress={closeDocument} />
      </>}
    </Card>)}
    <Button title={t('Refresh review status')} variant="quiet" disabled={loading || !!opening} onPress={() => void refresh()} />
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10, marginBottom: 20 },
  heading: { color: colors.navy, fontSize: 17, fontWeight: '700', lineHeight: 24 },
  title: { color: colors.navy, fontSize: 16, fontWeight: '700', lineHeight: 23 },
  label: { color: colors.navy, fontSize: 13, fontWeight: '700', lineHeight: 20 },
  caption: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  note: { color: colors.navy, fontSize: 14, lineHeight: 21 },
});
