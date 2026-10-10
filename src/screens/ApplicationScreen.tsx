import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { DraftSummary, FormRecord } from '../types';
import catalogFile from '../../data/forms-catalog.json';

const forms = catalogFile.forms as FormRecord[];

export type ApplicationScreenProps = {
  onSelectForm: (formId: string) => void;
  drafts: DraftSummary[];
  loading?: boolean;
  error?: string;
  onRetry: () => void;
  onResume: (formId: string) => void;
  onRemove: (formId: string) => Promise<void>;
};

export function ApplicationScreen({ onSelectForm, drafts, loading, error, onRetry, onResume, onRemove }: ApplicationScreenProps) {
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
    <Text accessibilityRole="header" style={styles.title}>My Application</Text>
    <Text style={styles.intro}>Choose a form, then choose how to fill it out.</Text>
    {loading && <Text style={styles.status}>Loading saved drafts…</Text>}
    {!!error && <View style={styles.note}>
      <Text accessibilityRole="alert" style={styles.noteText}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.secondaryButton}><Text style={styles.buttonText}>Try again</Text></Pressable>
    </View>}
    {!!drafts.length && <>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Saved drafts</Text>
      {drafts.map(draft => <View key={draft.formId} style={styles.draftCard}>
        <View style={styles.draftHeading}>
          <View style={styles.draftBadge}><Text style={styles.draftBadgeText}>{draft.formId}</Text></View>
          <Text style={styles.draftProgress}>{draft.answered} of {draft.total} questions answered</Text>
        </View>
        <Text style={styles.draftTitle}>{draft.title}</Text>
        <Text style={styles.draftDescription}>Saved {new Date(draft.updatedAt).toLocaleDateString()} on this device · Not filed</Text>
        {removing === draft.formId ? <View style={styles.confirmation}>
          <Text style={styles.noteText}>Remove the saved {draft.formId} draft? This cannot be undone.</Text>
          {!!removeError && <Text accessibilityRole="alert" style={styles.noteText}>{removeError}</Text>}
          <View style={styles.draftActions}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void remove(draft.formId)} style={[styles.secondaryButton, styles.actionButton, busy && styles.disabled]}><Text style={styles.removeText}>{busy ? 'Removing…' : 'Remove draft'}</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setRemoving(undefined); setRemoveError(''); }} style={[styles.secondaryButton, styles.actionButton, busy && styles.disabled]}><Text style={styles.buttonText}>Keep draft</Text></Pressable>
          </View>
        </View> : <View style={styles.draftActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Continue application ${draft.formId}`} onPress={() => onResume(draft.formId)} style={({ pressed }) => [styles.resumeButton, pressed && styles.pressed]}><Text style={styles.buttonText}>Continue application</Text><Ionicons name="arrow-forward" size={18} color="#061B49" /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove draft ${draft.formId}`} onPress={() => { setRemoving(draft.formId); setRemoveError(''); }} style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}><Ionicons name="trash-outline" size={19} color="#667085" /></Pressable>
        </View>}
      </View>)}
      <Text accessibilityRole="header" style={styles.sectionTitle}>All forms</Text>
    </>}
    <View style={styles.formList}>
      {forms.map((form, index) => <Pressable
        key={form.id}
        accessibilityRole="button"
        accessibilityLabel={`${form.id}, ${form.title}`}
        accessibilityHint="Choose how you want to fill out this form"
        onPress={() => onSelectForm(form.id)}
        style={({ pressed }) => [styles.formRow, index > 0 && styles.formSeparator, pressed && styles.formPressed]}
      >
        <View style={styles.formBadge}><Text style={styles.formBadgeText}>{form.id}</Text></View>
        <Text style={styles.formTitle}>{form.title}</Text>
        <Ionicons name="chevron-forward" size={18} color="#718098" />
      </Pressable>)}
    </View>
    <Text style={styles.footnote}>Use Save for later to keep a draft on this device. Drafts are not completed or filed USCIS applications.</Text>
  </ScrollView>;
}

export default ApplicationScreen;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F8FC' },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 18 },
  title: { fontSize: 28, lineHeight: 35, fontWeight: '800', color: '#061B49' },
  intro: { fontSize: 14, lineHeight: 21, color: '#5F6B7B', marginTop: 4, marginBottom: 16 },
  status: { fontSize: 13, lineHeight: 20, color: '#5F6B7B', marginBottom: 12 },
  sectionTitle: { fontSize: 16, lineHeight: 23, fontWeight: '700', color: '#061B49', marginBottom: 10 },
  formList: { backgroundColor: '#FFFFFF', borderColor: '#E2E7EF', borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  formRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12 },
  formSeparator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E2E7EF' },
  formPressed: { backgroundColor: '#EDF5FF' },
  formBadge: { width: 74, borderRadius: 9, paddingHorizontal: 5, paddingVertical: 8, backgroundColor: '#E5F0FF', alignItems: 'center' },
  formBadgeText: { fontSize: 13, lineHeight: 19, fontWeight: '800', color: '#061B49' },
  formTitle: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600', color: '#061B49' },
  draftCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E7EF', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12, gap: 7 },
  draftHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  draftBadge: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#061B49' },
  draftBadgeText: { fontSize: 12, lineHeight: 18, fontWeight: '700', color: '#FFFFFF' },
  draftProgress: { fontSize: 12, lineHeight: 18, color: '#5F6B7B' },
  draftTitle: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: '#061B49' },
  draftDescription: { fontSize: 11, lineHeight: 17, color: '#667085' },
  draftActions: { flexDirection: 'row', gap: 8 },
  resumeButton: { flex: 1, minHeight: 44, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#EDF5FF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  removeButton: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E2E7EF', borderRadius: 10 },
  confirmation: { gap: 8 },
  buttonText: { fontSize: 13, lineHeight: 19, fontWeight: '700', color: '#061B49', flexShrink: 1 },
  removeText: { fontSize: 13, lineHeight: 19, fontWeight: '700', color: '#A33535', flexShrink: 1 },
  secondaryButton: { minHeight: 44, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#D6DFEC', alignItems: 'center', justifyContent: 'center' },
  actionButton: { flex: 1 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  note: { gap: 8, marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: '#EDF2FA' },
  noteText: { fontSize: 12, lineHeight: 18, color: '#4E5E75' },
  footnote: { fontSize: 11, lineHeight: 17, color: '#667085', marginTop: 12 },
});
