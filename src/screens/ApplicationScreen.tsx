import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { DraftSummary } from '../types';

export type ApplicationScreenProps = {
  onStart: () => void;
  drafts: DraftSummary[];
  loading?: boolean;
  error?: string;
  onRetry: () => void;
  onResume: (formId: string) => void;
  onRemove: (formId: string) => Promise<void>;
};

export function ApplicationScreen({ onStart, drafts, loading, error, onRetry, onResume, onRemove }: ApplicationScreenProps) {
  const [removing, setRemoving] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const remove = async (formId: string) => {
    if (busy) return;
    setBusy(true); setRemoveError('');
    try { await onRemove(formId); setRemoving(undefined); }
    catch { setRemoveError('Could not remove the saved draft. Please try again.'); }
    finally { setBusy(false); }
  };
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>YOUR PAPERWORK, IN ONE PLACE</Text>
    <Text accessibilityRole="header" style={styles.title}>My Application</Text>
    <Text style={styles.intro}>{drafts.length ? 'Continue a draft saved on this device.' : 'Start with the form that fits your next step.'}</Text>
    {loading && <Text style={styles.body}>Loading saved drafts…</Text>}
    {!!error && <View style={styles.note}><View style={styles.noteCopy}><Text accessibilityRole="alert" style={styles.noteText}>{error}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.secondaryButton}><Text style={styles.buttonText}>Try again</Text></Pressable></View></View>}
    {drafts.map(draft => <View key={draft.formId} style={[styles.draftCard, {marginBottom:16}]}>
      <View style={styles.draftHeading}><View style={styles.formBadge}><Text style={styles.formBadgeText}>{draft.formId}</Text></View><Text style={styles.sessionLabel}>SAVED ON THIS DEVICE</Text></View>
      <Text accessibilityRole="header" style={styles.draftTitle}>{draft.title}</Text>
      <Text style={styles.draftProgress}>{draft.answered} of {draft.total} introductory questions answered</Text>
      <Text style={styles.draftDescription}>Saved {new Date(draft.updatedAt).toLocaleDateString()}. This draft is not a completed USCIS application and has not been filed.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Continue application ${draft.formId}`} onPress={()=>onResume(draft.formId)} style={({pressed})=>[styles.startButton,pressed&&styles.pressed]}><Text style={styles.buttonText}>Continue application</Text><Ionicons name="arrow-forward" size={20} color="#061B49"/></Pressable>
      {removing===draft.formId ? <View>
        <Text style={[styles.noteText,{marginTop:18}]}>Remove the saved {draft.formId} draft from this device? This cannot be undone.</Text>
        {!!removeError && <Text accessibilityRole="alert" style={styles.noteText}>{removeError}</Text>}
        <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void remove(draft.formId)} style={[styles.secondaryButton,busy&&styles.disabled]}><Text style={styles.buttonText}>{busy?'Removing…':'Remove saved draft'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setRemoving(undefined);setRemoveError('');}} style={styles.secondaryButton}><Text style={styles.buttonText}>Keep draft</Text></Pressable>
      </View> : <Pressable accessibilityRole="button" accessibilityLabel={`Remove draft ${draft.formId}`} onPress={()=>{setRemoving(draft.formId);setRemoveError('');}} style={styles.secondaryButton}><Text style={styles.buttonText}>Remove draft</Text></Pressable>}
    </View>)}
    {!loading && !error && !drafts.length && <View style={styles.emptyCard}>
      <View style={styles.iconCircle}><Ionicons name="document-text-outline" size={38} color="#061B49"/></View>
      <Text accessibilityRole="header" style={styles.emptyTitle}>Your next step starts here</Text>
      <Text style={styles.body}>Choose a form and begin the guided questions. Tap Save for later to keep your draft here.</Text>
    </View>}
    <Pressable accessibilityRole="button" onPress={onStart} style={({pressed})=>[styles.startButton,pressed&&styles.pressed]}><Text style={styles.buttonText}>{drafts.length?'Start another form':'Start a form'}</Text><Ionicons name="arrow-forward" size={20} color="#061B49"/></Pressable>
    <View style={styles.note}><Ionicons name="information-circle-outline" size={21} color="#061B49"/><View style={styles.noteCopy}><Text style={styles.noteTitle}>Your device, your draft</Text><Text style={styles.noteText}>Drafts are saved only when you choose Save for later. They stay on this browser or device until removed or its storage is cleared. Use sample details while testing on a shared computer.</Text></View></View>
    <Text style={styles.footnote}>No cloud account, automatic backup or government filing is connected.</Text>
  </ScrollView>;
}

export default ApplicationScreen;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F8FC' },
  content: { paddingHorizontal: 22, paddingTop: 28, paddingBottom: 36, flexGrow: 1 },
  eyebrow: { fontSize: 10, lineHeight: 16, letterSpacing: 1.5, fontWeight: '700', color: '#7F6531', marginBottom: 8 },
  title: { fontSize: 30, lineHeight: 38, fontWeight: '800', color: '#061B49' },
  intro: { fontSize: 16, lineHeight: 24, color: '#5F6B7B', marginTop: 8, marginBottom: 26 },
  emptyCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E7EF', borderWidth: 1, borderRadius: 24, padding: 24, alignItems: 'center' },
  iconCircle: { height: 78, width: 78, borderRadius: 24, backgroundColor: '#FBF3DF', alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  emptyTitle: { fontSize: 23, lineHeight: 30, fontWeight: '700', color: '#061B49', textAlign: 'center', marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 23, color: '#5F6B7B', textAlign: 'center' },
  startButton: { minHeight: 52, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 20, marginTop: 24, backgroundColor: '#D8AE55', width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  buttonText: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: '#061B49', flexShrink: 1 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginTop: 22, padding: 16, borderRadius: 16, backgroundColor: '#EDF2FA' },
  noteCopy: { flex: 1 },
  noteTitle: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: '#061B49', marginBottom: 4 },
  noteText: { fontSize: 13, lineHeight: 20, color: '#4E5E75' },
  footnote: { fontSize: 12, lineHeight: 18, color: '#667085', textAlign: 'center', marginTop: 18 },
  draftCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E7EF', borderWidth: 1, borderRadius: 24, padding: 22 },
  draftHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 17 },
  formBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#061B49' },
  formBadgeText: { fontSize: 13, lineHeight: 19, fontWeight: '700', color: '#FFFFFF' },
  sessionLabel: { fontSize: 9, lineHeight: 15, letterSpacing: 1.1, color: '#7F6531', fontWeight: '700' },
  draftTitle: { fontSize: 22, lineHeight: 29, fontWeight: '700', color: '#061B49', marginBottom: 14 },
  draftProgress: { fontSize: 14, lineHeight: 22, fontWeight: '600', color: '#061B49', marginBottom: 10 },
  draftDescription: { fontSize: 13, lineHeight: 21, color: '#5F6B7B' },
  secondaryButton: { minHeight: 50, borderRadius: 14, paddingHorizontal: 15, paddingVertical: 13, marginTop: 10, borderWidth: 1, borderColor: '#D6DFEC', alignItems: 'center', justifyContent: 'center' },
});
