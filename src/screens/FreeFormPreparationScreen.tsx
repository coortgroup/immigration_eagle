import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, StyleSheet, Text, View } from 'react-native';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { Button } from '../components/UI';
import { FreePdfViewer } from '../components/FreePdfViewer';
import { createPrintableDocument, type PrintableDocument } from '../officialPdfDocument';
import { loadFreePdfTemplate } from '../freePdfTemplates';
import { pdfDraftProgress, pdfFromBase64, pdfToBase64, type PdfEditorHandle, type PdfEditorMessage } from '../pdfEditorBridge';
import { saveDraft, type SavedDraft } from '../draftStorage';
import type { DraftSummary, QualificationAnswer } from '../types';
import catalogFile from '../../data/forms-catalog.json';
import { colors } from '../theme';
import { useLanguage } from '../LanguageContext';

async function loadEditor(): Promise<string> {
  const asset = Asset.fromModule(require('../../assets/pdf-editor.html'));
  if (Platform.OS === 'web') {
    const response = await fetch(asset.localUri || asset.uri);
    if (!response.ok) throw new Error('The PDF editor could not be loaded.');
    return response.text();
  }
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('The PDF editor is unavailable on this device.');
  return new File(asset.localUri).text();
}

/** Manual self-preparation with local drafts independent of the AI interview. */
export function FreeFormPreparationScreen({ formId, onExit, onExitToApplications, applicationReturnRequest, draftOwner, isActive, initialDraft, checks, onDraftSaved, onSaveErrorChange }: {
  formId: string; officialUrl: string; onExit: () => void; isActive: boolean;
  draftOwner?: string | null;
  onExitToApplications?: () => void;
  applicationReturnRequest?: number;
  initialDraft?: SavedDraft; checks: Record<string, QualificationAnswer>; onDraftSaved?: (draft: DraftSummary) => void;
  onSaveErrorChange?: (failed: boolean) => void;
}) {
  const { language, t } = useLanguage();
  const languageRef = useRef(language);
  languageRef.current = language;
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const viewer = useRef<PdfEditorHandle>(null);
  const mounted = useRef(true);
  const exporting = useRef(false);
  const exiting = useRef(false);
  const lastApplicationReturn = useRef(applicationReturnRequest);
  const restoredDraft = useRef(initialDraft);
  const pendingDraft = useRef<SavedDraft | undefined>(undefined);
  const saveWork = useRef<Promise<boolean> | null>(null);
  const savedCallback = useRef(onDraftSaved);
  savedCallback.current = onDraftSaved;
  const currentDocument = useRef<PrintableDocument | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; currentDocument.current?.dispose(); };
  }, []);
  useEffect(() => {
    onSaveErrorChange?.(!!saveError);
    return () => onSaveErrorChange?.(false);
  }, [!!saveError, onSaveErrorChange]);
  useEffect(() => {
    let active = true;
    setHtml(''); setError('');
    Promise.all([loadEditor(), loadFreePdfTemplate(formId)]).then(([template, bytes]) => {
      if (!active) return;
      if (template.split('__FILLOUT_PDF_CONFIG__').length !== 2) throw new Error('The PDF editor is incomplete. Please rebuild the app.');
      const draft = pendingDraft.current || restoredDraft.current;
      const config = JSON.stringify({ formId, language: languageRef.current, base64: pdfToBase64(bytes), native: Platform.OS !== 'web',
        values: draft?.pdfValues, page: draft?.pdfPage, resume: !!draft?.pdfValues }).replace(/</g, '\\u003c');
      setHtml(template.replace('__FILLOUT_PDF_CONFIG__', () => config));
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'The form could not be opened. Please try again.'); });
    return () => { active = false; };
  }, [formId, attempt]);
  useEffect(() => {
    viewer.current?.reply({ type: 'set-language', language });
  }, [language, html]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const preventExit = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventExit);
    return () => window.removeEventListener('beforeunload', preventExit);
  }, [dirty]);

  const persistDraft = useCallback((draft: SavedDraft): Promise<boolean> => {
    if (mounted.current) setSaving(true);
    const operation = (async () => {
      try {
        // Queue every snapshot immediately so a concurrent Continue read awaits
        // all entered values in the shared draft-storage queue.
        await saveDraft(draft, draftOwner);
        restoredDraft.current = draft;
        if (mounted.current) savedCallback.current?.(draft);
        if (pendingDraft.current === draft) {
          pendingDraft.current = undefined;
          if (!mounted.current) return true;
          setDirty(false); setSaveError(''); setSaving(false);
          viewer.current?.reply({ type: 'draft-result' });
        }
        return true;
      } catch {
        if (mounted.current && pendingDraft.current === draft) {
          const detail = 'Your draft could not be saved. Your entries are still here. Try again before closing.';
          setSaveError(detail); setSaving(false);
          viewer.current?.reply({ type: 'draft-result', error: detail });
        }
        return false;
      }
    })();
    saveWork.current = operation;
    return operation;
  }, [draftOwner]);

  const flushDraft = useCallback(async (): Promise<boolean> => {
    let retried = false;
    while (pendingDraft.current) {
      const operation = saveWork.current || persistDraft(pendingDraft.current);
      const saved = await operation;
      if (operation !== saveWork.current) continue;
      if (saved) return true;
      if (retried) return false;
      retried = true;
      void persistDraft(pendingDraft.current);
    }
    return true;
  }, [persistDraft]);

  const onMessage = useCallback((message: PdfEditorMessage) => {
    if (message.type === 'ready' || message.type === 'change') {
      if (message.type === 'ready') { setError(''); viewer.current?.reply({ type: 'set-language', language: languageRef.current }); }
      const progress = pdfDraftProgress(message.values);
      if (!progress.total || (message.type === 'ready' && !initialDraft && !Object.keys(checks).length && !progress.answered)) return;
      pendingDraft.current = {
        version: 1, formId, title: initialDraft?.title || catalogFile.forms.find(form => form.id === formId)?.title || formId,
        ...progress, updatedAt: new Date().toISOString(), answers: initialDraft?.answers || {}, checks: { ...checks },
        mode: 'self', stage: 'freePreparation', pdfValues: { ...message.values }, pdfPage: message.page,
      };
      setDirty(true);
      void persistDraft(pendingDraft.current);
    }
    else if (message.type === 'busy') setBusy(message.value);
    else if (message.type === 'error') setError(message.error || message.message || 'The PDF editor could not load this form.');
    else if (message.type === 'export' && Platform.OS !== 'web' && !exporting.current) {
      if (message.action !== 'save' && message.action !== 'print') return;
      exporting.current = true; setBusy(true); setError('');
      void (async () => {
        let document: PrintableDocument | undefined;
        try {
          document = await createPrintableDocument(pdfFromBase64(message.base64), formId, t('Save or share completed form'));
          if (!mounted.current) return;
          currentDocument.current = document;
          if (message.action === 'print') {
            if (!document.print) throw new Error('Printing is not available on this device.');
            await document.print();
          } else await document.download();
          if (mounted.current) viewer.current?.reply({ type: 'export-result' });
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : 'The PDF could not be saved. Your entries are still here.';
          if (mounted.current) { setError(detail); viewer.current?.reply({ type: 'export-result', error: detail }); }
        } finally {
          document?.dispose(); currentDocument.current = undefined; exporting.current = false;
          if (mounted.current) setBusy(false);
        }
      })();
    }
  }, [formId, initialDraft, checks, persistDraft, t]);
  async function close(destination = onExit) {
    if (busy || exporting.current || exiting.current) return;
    exiting.current = true; setClosing(true);
    const saved = await flushDraft();
    if (mounted.current) {
      if (saved) destination();
      exiting.current = false; setClosing(false);
    }
  }
  useEffect(() => {
    if (lastApplicationReturn.current === applicationReturnRequest || busy) return;
    lastApplicationReturn.current = applicationReturnRequest;
    if (onExitToApplications) void close(onExitToApplications);
  }, [applicationReturnRequest, busy, onExitToApplications]);
  useEffect(() => {
    if (!isActive) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void close();
      return true;
    });
    return () => subscription.remove();
  }, [isActive, busy, onExit, flushDraft]);
  // Keep the frame mounted when the app switches tabs. Hiding a native Modal
  // would destroy the WebView and clear edits even though this screen survives.
  return <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.title}><Text accessibilityRole="header" style={styles.heading}>{t('{formId} · Free PDF form', { formId })}</Text></View>
        <Button title={t(closing ? 'Saving…' : 'Close')} variant="quiet" onPress={() => void close()} disabled={busy || closing} />
      </View>
      {!!error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{t(error)}</Text>{!html && <Button title={t('Try again')} variant="secondary" onPress={() => setAttempt(value => value + 1)} />}</View>}
      {!!saveError && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{t(saveError)}</Text><Button title={t('Retry saving draft')} variant="secondary" onPress={() => void flushDraft()} disabled={saving} /></View>}
      {html ? <FreePdfViewer ref={viewer} html={html} onMessage={onMessage} /> : !error && <View style={styles.loading}><ActivityIndicator size="large" color={colors.navy} /><Text style={styles.caption}>{t('Opening your PDF form…')}</Text></View>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.paper },
  header: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { flex: 1, gap: 4 }, heading: { fontSize: 18, fontWeight: '800', color: colors.navy }, caption: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  error: { padding: 12, gap: 8, backgroundColor: '#FFF4EF' }, errorText: { color: colors.error, fontSize: 13, lineHeight: 19 },
});
