import { localeFor } from '../i18n';
import { useLanguage } from '../LanguageContext';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { DraftSummary, FormRecord } from '../types';
import catalogFile from '../../data/forms-catalog.json';

const forms = catalogFile.forms as FormRecord[];
function isGuidedDraft(draft: DraftSummary) {
  return draft.mode === 'ai' || draft.stage === 'interview' || draft.stage === 'fullPreparation';
}

function GuidedDraftProgress({ draft }: { draft: DraftSummary }) {
  const { t } = useLanguage();
  // The saved counts already reflect active questions and completed optional steps.
  // A missing denominator must not imply that a draft is complete.
  if (!Number.isSafeInteger(draft.total) || draft.total <= 0 || !Number.isSafeInteger(draft.answered)) {
    return <Text style={styles.draftProgress}>{t('Progress unavailable')}</Text>;
  }
  const answered = Math.min(draft.total, Math.max(0, draft.answered));
  const remaining = draft.total - answered;
  // Keep 100% reserved for drafts with no unanswered questions in this stage.
  const percent = Math.floor(answered / draft.total * 100);
  const stage = t(draft.stage === 'check' ? 'Preliminary check' : 'FillOut preparation');
  const remainingText = remaining === 0 ? t('No questions remaining')
    : remaining === 1 ? t('1 question remaining') : t('{count} questions remaining', { count: remaining });
  return <View style={styles.guidedProgress}>
    <View style={styles.progressSummary}>
      <Text style={styles.progressPercent}>{t('{percent}% complete', { percent })}</Text>
      <Text style={styles.draftProgress}>{remainingText}</Text>
    </View>
    <View accessibilityRole="progressbar"
      accessibilityLabel={t('{formId}: {stage} progress', { formId: draft.formId, stage })}
      accessibilityValue={{ min: 0, max: 100, now: percent, text: t('{percent}% complete', { percent }) }}
      style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${percent}%` }]} />
    </View>
    <Text style={styles.draftProgress}>{t('{count} of {total} questions answered', { count: answered, total: draft.total })}</Text>
  </View>;
}

export type ApplicationScreenProps = {
  reviewPanel?: React.ReactNode;
  onSelectForm: (formId: string) => void;
  drafts: DraftSummary[];
  loading?: boolean;
  error?: string;
  onRetry: () => void;
  onResume: (formId: string) => void;
  onRemove: (formId: string) => Promise<void>;
};

export function ApplicationScreen({ reviewPanel, onSelectForm, drafts, loading, error, onRetry, onResume, onRemove }: ApplicationScreenProps) {
  const { t, language } = useLanguage();
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
    <Text accessibilityRole="header" style={styles.title}>{t("My Application")}</Text>
    <Text style={styles.intro}>{t("Choose a form, then choose how to fill it out.")}</Text>
    {reviewPanel}
    {loading && <Text style={styles.status}>{t("Loading saved drafts…")}</Text>}
    {!!error && <View style={styles.note}>
      <Text accessibilityRole="alert" style={styles.noteText}>{t(error)}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.secondaryButton}><Text style={styles.buttonText}>{t("Try again")}</Text></Pressable>
    </View>}
    {!!drafts.length && <>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{t("Saved drafts")}</Text>
      {drafts.map(draft => <View key={draft.formId} style={styles.draftCard}>
        <View style={styles.draftHeading}>
          <View style={styles.draftBadge}><Text style={styles.draftBadgeText}>{draft.formId}</Text></View>
          <Text style={styles.draftProgress}>{t(draft.mode === 'attorney' ? 'Attorney contact request'
            : isGuidedDraft(draft) ? draft.stage === 'check' ? 'Preliminary check' : 'FillOut preparation'
              : `${draft.answered} of ${draft.total} questions answered`)}</Text>
        </View>
        <Text style={styles.draftTitle}>{t(draft.title)}</Text>
        {draft.mode !== 'attorney' && isGuidedDraft(draft) && <GuidedDraftProgress draft={draft} />}
        <Text style={styles.draftDescription}>{t('Saved {date} on this device', {date: new Date(draft.updatedAt).toLocaleDateString(localeFor(language))})}{t(draft.mode !== 'attorney' ? ' · Not filed' : '')}</Text>
        {draft.mode === 'attorney' && <Text style={styles.draftDescription}>{t('Free contact request. Review your details and permission to share before sending. Legal services are arranged directly with the attorney.')}</Text>}
        {removing === draft.formId ? <View style={styles.confirmation}>
          <Text style={styles.noteText}>{t('Remove the saved {formId} draft? This cannot be undone.', { formId: draft.formId })}</Text>
          {!!removeError && <Text accessibilityRole="alert" style={styles.noteText}>{t(removeError)}</Text>}
          <View style={styles.draftActions}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void remove(draft.formId)} style={[styles.secondaryButton, styles.actionButton, busy && styles.disabled]}><Text style={styles.removeText}>{t(busy ? 'Removing…' : 'Remove draft')}</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setRemoving(undefined); setRemoveError(''); }} style={[styles.secondaryButton, styles.actionButton, busy && styles.disabled]}><Text style={styles.buttonText}>{t("Keep draft")}</Text></Pressable>
          </View>
        </View> : <View style={[styles.draftActions, draft.mode === 'attorney' && styles.attorneyActions]}>
          {<Pressable accessibilityRole="button" accessibilityLabel={t(draft.mode === 'attorney' ? `Continue request ${draft.formId}` : `Continue application ${draft.formId}`)} onPress={() => onResume(draft.formId)} style={({ pressed }) => [styles.resumeButton, pressed && styles.pressed]}><Text style={styles.buttonText}>{t(draft.mode === 'attorney' ? 'Continue request' : 'Continue application')}</Text><Ionicons name="arrow-forward" size={18} color="#061B49" /></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel={t(`Remove draft ${draft.formId}`)} onPress={() => { setRemoving(draft.formId); setRemoveError(''); }} style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}><Ionicons name="trash-outline" size={19} color="#667085" /></Pressable>
        </View>}
      </View>)}
      <Text accessibilityRole="header" style={styles.sectionTitle}>{t("All forms")}</Text>
    </>}
    <View style={styles.formList}>
      {forms.map((form, index) => <Pressable
        key={form.id}
        accessibilityRole="button"
        accessibilityLabel={`${form.id}, ${t(form.title)}`}
        accessibilityHint={t("Choose how you want to fill out this form")}
        onPress={() => onSelectForm(form.id)}
        style={({ pressed }) => [styles.formRow, index > 0 && styles.formSeparator, pressed && styles.formPressed]}
      >
        <View style={styles.formBadge}><Text style={styles.formBadgeText}>{form.id}</Text></View>
        <Text style={styles.formTitle}>{t(form.title)}</Text>
        <Ionicons name="chevron-forward" size={18} color="#718098" />
      </Pressable>)}
    </View>
    <Text style={styles.footnote}>{t("Your progress is saved automatically on this device, starting with your first answer. Drafts are not completed or filed USCIS applications.")}</Text>
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
  guidedProgress: { gap: 7, marginTop: 3, marginBottom: 3 },
  progressSummary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 },
  progressPercent: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: '#061B49' },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: '#E2E7EF', overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: '#2873C8' },
  draftTitle: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: '#061B49' },
  draftDescription: { fontSize: 11, lineHeight: 17, color: '#667085' },
  draftActions: { flexDirection: 'row', gap: 8 },
  attorneyActions: { justifyContent: 'flex-end' },
  tracker: { marginTop: 5 },
  trackerStep: { flexDirection: 'row', gap: 10, minHeight: 54 },
  trackerRail: { width: 28, alignItems: 'center' },
  trackerNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EDF2FA', alignItems: 'center', justifyContent: 'center' },
  trackerNumberActive: { backgroundColor: '#061B49' },
  trackerNumberText: { fontSize: 12, lineHeight: 18, fontWeight: '700', color: '#667085' },
  trackerNumberTextActive: { color: '#FFFFFF' },
  trackerLine: { width: 2, flex: 1, backgroundColor: '#E2E7EF', marginVertical: 3 },
  trackerLineComplete: { backgroundColor: '#061B49' },
  trackerLabel: { flex: 1, paddingTop: 2, paddingBottom: 11, gap: 2 },
  trackerStepText: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: '#667085' },
  trackerStepTextActive: { color: '#061B49' },
  trackerStatus: { fontSize: 11, lineHeight: 16, color: '#667085' },
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
