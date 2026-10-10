import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { Button, Card, SectionTitle } from '../components/UI';
import { FreePdfViewer } from '../components/FreePdfViewer';
import { createPrintableDocument, type PrintableDocument } from '../officialPdfDocument';
import { loadFreePdfTemplate } from '../freePdfTemplates';
import { pdfFromBase64, pdfToBase64, type PdfEditorHandle, type PdfEditorMessage } from '../pdfEditorBridge';
import { colors } from '../theme';

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

/** Manual self-preparation, independent of AI interviews and stored intake drafts. */
export function FreeFormPreparationScreen({ formId, officialUrl, onExit, isActive }: {
  formId: string; officialUrl: string; onExit: () => void; isActive: boolean;
}) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const viewer = useRef<PdfEditorHandle>(null);
  const mounted = useRef(true);
  const exporting = useRef(false);
  const currentDocument = useRef<PrintableDocument | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; currentDocument.current?.dispose(); };
  }, []);
  useEffect(() => {
    let active = true;
    setHtml(''); setError('');
    Promise.all([loadEditor(), loadFreePdfTemplate(formId)]).then(([template, bytes]) => {
      if (!active) return;
      if (template.split('__FILLOUT_PDF_CONFIG__').length !== 2) throw new Error('The PDF editor is incomplete. Please rebuild the app.');
      const config = JSON.stringify({ formId, base64: pdfToBase64(bytes), native: Platform.OS !== 'web' }).replace(/</g, '\\u003c');
      setHtml(template.replace('__FILLOUT_PDF_CONFIG__', () => config));
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'The form could not be opened. Please try again.'); });
    return () => { active = false; };
  }, [formId, attempt]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const preventExit = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventExit);
    return () => window.removeEventListener('beforeunload', preventExit);
  }, [dirty]);

  const onMessage = useCallback((message: PdfEditorMessage) => {
    if (message.type === 'ready') setError('');
    else if (message.type === 'dirty') setDirty(true);
    else if (message.type === 'busy') setBusy(message.value);
    else if (message.type === 'error') setError(message.error || message.message || 'The PDF editor could not load this form.');
    else if (message.type === 'export' && Platform.OS !== 'web' && !exporting.current) {
      if (message.action !== 'save' && message.action !== 'print') return;
      exporting.current = true; setBusy(true); setError('');
      void (async () => {
        let document: PrintableDocument | undefined;
        try {
          document = await createPrintableDocument(pdfFromBase64(message.base64), formId);
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
  }, [formId]);
  function close() {
    if (busy || exporting.current) return;
    if (dirty) setLeaving(true); else onExit();
  }
  useEffect(() => {
    if (!isActive) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (leaving) setLeaving(false); else close();
      return true;
    });
    return () => subscription.remove();
  }, [isActive, dirty, busy, leaving, onExit]);
  // Keep the frame mounted when the app switches tabs. Hiding a native Modal
  // would destroy the WebView and clear edits even though this screen survives.
  return <View style={[styles.root, Platform.OS === 'web' && styles.webWindow]}>
      <View style={styles.header}>
        <View style={styles.title}><Text accessibilityRole="header" style={styles.heading}>{formId} · Free PDF form</Text></View>
        <Button title="Close" variant="quiet" onPress={close} disabled={busy} />
      </View>
      {!!error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>{!html && <Button title="Try again" variant="secondary" onPress={() => setAttempt(value => value + 1)} />}</View>}
      {html ? <FreePdfViewer ref={viewer} html={html} onMessage={onMessage} /> : !error && <View style={styles.loading}><ActivityIndicator size="large" color={colors.navy} /><Text style={styles.caption}>Opening your PDF form…</Text></View>}
      <View style={styles.footer}><Text style={styles.footerCopy}>Save your PDF before closing. Complete the applicable fields and sign where required. Check the current edition before filing.</Text><Pressable accessibilityRole="link" style={styles.instructions} onPress={() => void Linking.openURL(officialUrl).catch(() => setError('The USCIS page could not be opened. Please try again.'))}><Text style={styles.instructionsText}>USCIS instructions ↗</Text></Pressable></View>
      <Modal visible={isActive && leaving} transparent animationType="fade" onRequestClose={() => setLeaving(false)}>
        <View style={styles.overlay}><Card style={styles.exitCard}><SectionTitle title="Close your PDF form?" subtitle="Your entries stay in this window until you close it. Save the filled PDF first to keep a copy." /><Button title="Keep filling out my form" onPress={() => setLeaving(false)} /><Button title="Discard session and close" variant="secondary" onPress={onExit} /></Card></View>
      </Modal>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  webWindow: { position: 'fixed', inset: 0, zIndex: 100, display: 'flex' } as any,
  header: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { flex: 1, gap: 4 }, heading: { fontSize: 18, fontWeight: '800', color: colors.navy }, caption: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  footer: { paddingHorizontal: 12, paddingVertical: 4, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: colors.border },
  footerCopy: { color: colors.muted, fontSize: 11, lineHeight: 16, flex: 1, minWidth: 190 },
  instructions: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, instructionsText: { color: colors.navy, fontSize: 12, fontWeight: '700' },
  error: { padding: 12, gap: 8, backgroundColor: '#FFF4EF' }, errorText: { color: colors.error, fontSize: 13, lineHeight: 19 },
  overlay: { flex: 1, padding: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: '#071B3A66' },
  exitCard: { width: '100%', maxWidth: 480 },
});
