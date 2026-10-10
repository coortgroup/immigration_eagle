import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Badge, BrandMark, Button, Card, Field, Notice, RowLink, SectionTitle } from '../components/UI';
import { DocumentDelivery } from '../components/DocumentDelivery';
import { colors, radius } from '../theme';
import { activeQuestions, conditionMatches, activeAnswers, i90Questionnaire, mapI90Answers, questionForPdfField, QuestionnaireValidationError, validateQuestion } from '../uscisQuestionnaire';
import { fillOfficialPrintPdf, PrintValidationError } from '../pdfEngine';
import { createPrintableDocument, loadPrintTemplate, PrintableDocument } from '../officialPdfDocument';

type Answers = Record<string, string | string[]>;
type Question = (typeof i90Questionnaire.questions)[number];
type FormField = Question['fields'][number];
type Stage = 'intro' | 'questions' | 'review' | 'document';

/** Full answers stay in this session; no AsyncStorage, analytics or AI uploads. */
export function FullFormPreparationScreen({ onExit, isActive }: { onExit: () => void; isActive: boolean }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [stage, setStage] = useState<Stage>('intro');
  const [questionId, setQuestionId] = useState(i90Questionnaire.questions[0].id);
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorQuestion, setErrorQuestion] = useState<string>();
  const [document, setDocument] = useState<PrintableDocument>();
  const [revision, setRevision] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [picker, setPicker] = useState<FormField>();
  const [search, setSearch] = useState('');
  const scroll = useRef<ScrollView>(null);
  const documentRef = useRef<PrintableDocument | undefined>(undefined);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const questions = useMemo(() => activeQuestions(answers), [answers]);
  const index = Math.max(0, questions.findIndex(item => item.id === questionId));
  const question = questions[index];
  const hasAnswers = Object.values(answers).some(value => Array.isArray(value) ? value.length > 0 : !!value.trim());

  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [stage, questionId]);
  useEffect(() => () => { generation.current += 1; documentRef.current?.dispose(); }, []);
  useEffect(() => {
    if (Platform.OS !== 'web' || !hasAnswers) return;
    const preventAccidentalExit = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventAccidentalExit);
    return () => window.removeEventListener('beforeunload', preventAccidentalExit);
  }, [hasAnswers]);

  function exit() {
    if (busyRef.current) return;
    if (hasAnswers) setLeaving(true); else onExit();
  }
  function back() {
    if (busyRef.current) return true;
    if (picker) { setPicker(undefined); return true; }
    if (leaving) { setLeaving(false); return true; }
    if (stage === 'document') setStage('review');
    else if (stage === 'review') { setEditing(false); setQuestionId(questions[questions.length - 1].id); setStage('questions'); }
    else if (stage === 'questions') {
      setErrors({});
      if (editing) { setEditing(false); setStage('review'); }
      else if (index > 0) setQuestionId(questions[index - 1].id);
      else setStage('intro');
    } else exit();
    return true;
  }
  useEffect(() => {
    if (!isActive) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', back);
    return () => subscription.remove();
  }, [isActive, stage, questionId, editing, picker, leaving, answers]);

  function update(fieldId: string, value: string | string[]) {
    setAnswers(current => ({ ...current, [fieldId]: value }));
    setErrors({}); setConfirmed(false); setError(''); setErrorQuestion(undefined);
    documentRef.current?.dispose(); documentRef.current = undefined; setDocument(undefined);
  }
  function next() {
    const invalid = validateQuestion(question, answers);
    setErrors(invalid);
    if (Object.keys(invalid).length) return;
    if (editing || index === questions.length - 1) { setEditing(false); setStage('review'); }
    else setQuestionId(questions[index + 1].id);
  }
  function edit(id: string) { setQuestionId(id); setEditing(true); setErrors({}); setStage('questions'); }
  async function generate() {
    if (!confirmed || busyRef.current) return;
    for (const item of questions) {
      const invalid = validateQuestion(item, answers);
      if (Object.keys(invalid).length) { edit(item.id); setErrors(invalid); return; }
    }
    busyRef.current = true; setBusy(true); setError(''); setErrorQuestion(undefined);
    const request = ++generation.current;
    try {
      const mapped = mapI90Answers(answers);
      const template = await loadPrintTemplate(require('../../assets/uscis-print/i-90.pdf'));
      const bytes = await fillOfficialPrintPdf(template, mapped.definition, mapped.answers);
      const result = await createPrintableDocument(bytes, 'I-90');
      if (request !== generation.current) { result.dispose(); return; }
      documentRef.current?.dispose(); documentRef.current = result; setDocument(result);
      setRevision(value => value + 1); setStage('document');
    } catch (cause) {
      if (request !== generation.current) return;
      const missingExplanation = cause instanceof QuestionnaireValidationError && (cause.errors.removal_history || cause.errors.abandonment_history);
      const linkedQuestion = missingExplanation ? questions.find(item => item.id.startsWith('additional-') && item.fields.every(field => !answers[field.id])) || questions.find(item => item.id === 'additional-1')
        : cause instanceof PrintValidationError && cause.fieldName ? questionForPdfField(cause.fieldName)
        : cause instanceof QuestionnaireValidationError ? questions.find(item => item.fields.some(field => !!cause.errors[field.id])) : undefined;
      setErrorQuestion(linkedQuestion?.id);
      setError(cause instanceof PrintValidationError || cause instanceof QuestionnaireValidationError ? `${linkedQuestion ? `${linkedQuestion.title}: ` : ''}${cause.message}` : 'The PDF could not be created. Your answers are still here. Please try again.');
    } finally { if (request === generation.current) { busyRef.current = false; setBusy(false); } }
  }

  function answerLabel(field: FormField): string {
    const value = answers[field.id];
    if (!value || (Array.isArray(value) && !value.length)) return 'Left blank';
    const values = Array.isArray(value) ? value : [value];
    return values.map(item => field.options?.find(option => option.value === item)?.label || item).join(', ');
  }
  function control(field: FormField) {
    const selected = answers[field.id];
    const required = field.required || (!!field.requiredWhen && conditionMatches(field.requiredWhen, activeAnswers(answers)));
    const title = `${field.label}${required || /if applicable|if any|optional/i.test(field.label) ? '' : ' · if applicable'}`;
    if (field.type === 'select') return <View key={field.id} style={styles.field}>
      <Text style={styles.label}>{title}</Text>
      <Button title={selected ? answerLabel(field) : 'Choose an answer'} accessibilityLabel={title} variant="secondary" icon="chevron-down" onPress={() => { setSearch(''); setPicker(field); }} />
      {!!errors[field.id] && <Text accessibilityRole="alert" style={styles.error}>{errors[field.id]}</Text>}
    </View>;
    if (field.type === 'radio' || field.type === 'multiselect') return <View key={field.id} style={styles.field}>
      <Text style={styles.label}>{title}</Text>
      {field.options?.map(option => {
        const multi = field.type === 'multiselect';
        const checked = multi ? Array.isArray(selected) && selected.includes(option.value) : selected === option.value;
        return <Pressable key={option.value} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked }} accessibilityLabel={option.label} style={[styles.option, checked && styles.selected]} onPress={() => {
          if (!multi) update(field.id, option.value);
          else { const values = Array.isArray(selected) ? selected : []; update(field.id, checked ? values.filter(value => value !== option.value) : [...values, option.value]); }
        }}><Ionicons name={multi ? checked ? 'checkbox' : 'square-outline' : checked ? 'radio-button-on' : 'radio-button-off'} size={22} color={colors.navy} /><Text style={styles.optionText}>{option.label}</Text></Pressable>;
      })}
      {!field.required && !!selected && <Button title="Clear selection" variant="quiet" onPress={() => update(field.id, field.type === 'multiselect' ? [] : '')} />}
      {!!errors[field.id] && <Text accessibilityRole="alert" style={styles.error}>{errors[field.id]}</Text>}
    </View>;
    return <Field key={field.id} label={title} value={typeof selected === 'string' ? selected : ''} onChangeText={value => update(field.id, value)} multiline={field.type === 'textarea'} autoCorrect={false} autoCapitalize="none" placeholder={field.type === 'date' ? 'MM/DD/YYYY' : 'Enter your answer'} keyboardType={field.type === 'date' ? 'numbers-and-punctuation' : 'default'} error={errors[field.id]} />;
  }

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.scroll}>
      <View style={styles.content}>
        <Pressable accessibilityRole="button" accessibilityLabel={stage === 'intro' ? 'Preparation options' : 'Back'} disabled={busy} onPress={back} style={styles.back}><Ionicons name="arrow-back" size={21} color={colors.navy} /><Text style={styles.label}>{stage === 'intro' ? 'Preparation options' : 'Back'}</Text></Pressable>
        <Badge gold>I-90 · {stage === 'document' ? 'PRINT & SIGN' : 'GUIDED PREPARATION'}</Badge>
        {stage === 'intro' && <>
          <BrandMark compact /><SectionTitle title="Your answers. Your official form." subtitle="Work through the I-90 questions, read an explanation below each question, and review your answers before creating the printable USCIS PDF." />
          <Card><Text style={styles.label}>What you’ll prepare</Text><Text style={styles.body}>Applicant information, your reason for applying, processing details, interpreter or preparer information when applicable, and additional information.</Text><Text style={styles.body}>Signatures stay blank for signing after you print. The form uses edition {i90Questionnaire.edition}.</Text></Card>
          <Notice title="Keep this session open">These full-form answers stay in this open session. They are not saved for later or sent to an AI service. Download your PDF before leaving. Explanations are based on the official instructions.</Notice>
          <Button title={hasAnswers ? 'Continue my answers' : 'Start I-90 questions'} variant="gold" icon="arrow-forward" onPress={() => setStage('questions')} />
          <Button title="Read official I-90 instructions" variant="secondary" icon="open-outline" onPress={() => { void Linking.openURL(i90Questionnaire.instructionsUrl).catch(() => setError('The instructions could not be opened. Please try again.')); }} />
        </>}
        {stage === 'questions' && question && <>
          <View style={styles.row}><Text style={styles.caption}>{editing ? 'Edit answer' : `Question ${index + 1} of ${questions.length}`}</Text><Text style={styles.caption}>Part {question.part} · Item {question.item}</Text></View>
          <View style={styles.track}><View style={[styles.fill, { width: `${(index + 1) / questions.length * 100}%` }]} /></View>
          <SectionTitle title={question.title} />
          {question.fields.map(control)}
          <Notice title="About this question">{question.help}</Notice>
          <Button title={editing ? 'Update answer' : index === questions.length - 1 ? 'Review all answers' : 'Next question'} variant="gold" icon="arrow-forward" onPress={next} />
          <Button title="Review progress" variant="quiet" onPress={() => setStage('review')} />
        </>}
        {stage === 'review' && <>
          <SectionTitle title="Review your I-90" subtitle="Check every answer. Tap a question to make a correction." />
          <Card>{questions.map(item => <RowLink key={item.id} title={`Part ${item.part} · ${item.title}`} subtitle={item.fields.map(field => `${field.label}: ${answerLabel(field)}`).join('\n')} icon="create-outline" onPress={() => { if (!busy) edit(item.id); }} />)}</Card>
          <Notice title="After printing">{i90Questionnaire.signing.filter(item => conditionMatches(item.when, activeAnswers(answers))).map(item => item.instruction).join('\n\n')}</Notice>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed, disabled: busy }} disabled={busy} onPress={() => setConfirmed(!confirmed)} style={styles.option}><Ionicons name={confirmed ? 'checkbox' : 'square-outline'} size={24} color={colors.navy} /><Text style={styles.optionText}>I have reviewed my answers and want to create my printable form.</Text></Pressable>
          <Button title={busy ? 'Creating your PDF…' : 'Create filled official PDF'} disabled={!confirmed || busy} variant="gold" icon="document-text-outline" onPress={() => void generate()} />
          <Text style={styles.caption}>The PDF is a static print copy. Review it before signing. Creating it does not submit an application or charge a fee.</Text>
        </>}
        {stage === 'document' && document && <>
          <SectionTitle title="Your I-90 is ready to review" subtitle="Download the official form with your answers, print it, and sign where required." />
          <DocumentDelivery formId="I-90" pdfReady documentRevision={String(revision)} onDownloadPdf={document.download} onPrintPdf={document.print} onSharePdf={document.share} />
          <Button title="Edit my answers" variant="secondary" icon="create-outline" onPress={() => setStage('review')} />
        </>}
        {!!error && <Notice tone="warning"><Text accessibilityRole="alert" style={styles.error}>{error}</Text>{errorQuestion && <Button title="Review this answer" variant="secondary" onPress={() => edit(errorQuestion)} />}</Notice>}
        {hasAnswers && stage !== 'intro' && <Button title="Leave this form" disabled={busy} variant="quiet" onPress={exit} />}
      </View>
    </ScrollView>
    <Modal visible={isActive && !!picker} animationType="slide" transparent onRequestClose={() => setPicker(undefined)}>
      <View style={styles.overlay}><View style={styles.sheet} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={styles.label}>{picker?.label}</Text>
        <Field label="Search choices" value={search} onChangeText={setSearch} autoCapitalize="none" />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.field}>
          {picker?.options?.filter(option => `${option.label} ${option.value}`.toLowerCase().includes(search.toLowerCase())).map(option => <RowLink key={option.value} title={option.label} onPress={() => { update(picker.id, option.value); setPicker(undefined); }} />)}
        </ScrollView>
        {picker && !picker.required && <Button title="Leave blank" variant="secondary" onPress={() => { update(picker.id, ''); setPicker(undefined); }} />}
        <Button title="Close choices" variant="quiet" onPress={() => setPicker(undefined)} />
      </View></View>
    </Modal>
    <Modal visible={isActive && leaving} animationType="fade" transparent onRequestClose={() => setLeaving(false)}>
      <View style={styles.overlay}><Card style={styles.exitCard}><SectionTitle title="Leave this session?" subtitle="Your full-form answers will be cleared. Download your PDF first if you want to keep it." /><Button title="Keep working" onPress={() => setLeaving(false)} /><Button title="Clear answers and leave" variant="secondary" onPress={onExit} /></Card></View>
    </Modal>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, scroll: { flexGrow: 1, padding: 18, paddingBottom: 24 }, content: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: 16 },
  back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9 }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 }, caption: { color: colors.muted, fontSize: 12, lineHeight: 19 }, label: { color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  field: { gap: 8 }, option: { padding: 13, gap: 10, flexDirection: 'row', alignItems: 'center', minHeight: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.paper }, selected: { borderColor: colors.navy, backgroundColor: colors.blueLight }, optionText: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 22 },
  track: { height: 5, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' }, fill: { height: 5, backgroundColor: colors.gold }, error: { color: colors.error, fontSize: 14, lineHeight: 21 },
  overlay: { flex: 1, backgroundColor: '#071B3A66', justifyContent: 'flex-end', padding: 16 }, sheet: { backgroundColor: colors.paper, maxHeight: '85%', padding: 18, paddingBottom: 26, borderRadius: radius.md, gap: 12 }, exitCard: { width: '100%', maxWidth: 560, alignSelf: 'center', marginBottom: 24 },
});
