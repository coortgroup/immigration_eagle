import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { DraftSummary } from '../types';

export type ApplicationScreenProps = {
  onStart?: () => void;
  draft?: DraftSummary;
  onResume?: () => void;
};

export function ApplicationScreen({ onStart, draft, onResume }: ApplicationScreenProps) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>YOUR PAPERWORK, IN ONE PLACE</Text>
      <Text accessibilityRole="header" style={styles.title}>My Application</Text>
      <Text style={styles.intro}>{draft ? 'Pick up your preparation where you left off.' : 'Start with the form that fits your next step.'}</Text>

      {draft ? (
        <View style={styles.draftCard}>
          <View style={styles.draftHeading}>
            <View style={styles.formBadge}><Text style={styles.formBadgeText}>{draft.formId}</Text></View>
            <Text style={styles.sessionLabel}>SESSION DRAFT</Text>
          </View>
          <Text accessibilityRole="header" style={styles.draftTitle}>{draft.title}</Text>
          <Text style={styles.draftProgress}>{draft.answered} of {draft.total} introductory questions answered</Text>
          <Text style={styles.draftDescription}>This is your preparation draft. It is not a complete USCIS application and has not been submitted.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityHint={onResume ? 'Returns to this form’s preparation flow.' : 'Preparation navigation is not available in this view.'}
            accessibilityState={{ disabled: !onResume }}
            disabled={!onResume}
            onPress={onResume}
            style={({ pressed }) => [styles.startButton, !onResume && styles.disabled, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>Return to preparation</Text>
            <Ionicons name="arrow-forward" size={20} color="#061B49" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the form catalog."
            accessibilityState={{ disabled: !onStart }}
            disabled={!onStart}
            onPress={onStart}
            style={({ pressed }) => [styles.secondaryButton, !onStart && styles.disabled, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>Start another form</Text>
          </Pressable>
        </View>
      ) : <View style={styles.emptyCard}>
        <View style={styles.iconCircle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Ionicons name="document-text-outline" size={38} color="#061B49" />
        </View>
        <Text accessibilityRole="header" style={styles.emptyTitle}>Your next step starts here</Text>
        <Text style={styles.body}>You haven’t started an application yet. Browse the forms, compare preparation options, and choose where to begin.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a form"
          accessibilityHint={onStart ? 'Opens the form catalog.' : 'Form navigation is not available in this view.'}
          accessibilityState={{ disabled: !onStart }}
          disabled={!onStart}
          onPress={onStart}
          style={({ pressed }) => [styles.startButton, !onStart && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>Start a form</Text>
          <Ionicons name="arrow-forward" size={20} color="#061B49" />
        </Pressable>
      </View>}

      <View style={styles.note}>
        <Ionicons name="information-circle-outline" size={21} color="#061B49" />
        <View style={styles.noteCopy}>
          <Text style={styles.noteTitle}>For this session only</Text>
          <Text style={styles.noteText}>Preparation drafts are kept in memory during this session. Closing or reloading the app clears them. Your information is not submitted or saved to an account.</Text>
        </View>
      </View>
      <Text style={styles.footnote}>No account or filing service is connected in this version.</Text>
    </ScrollView>
  );
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
