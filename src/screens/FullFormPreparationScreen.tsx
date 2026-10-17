import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { Badge, BrandMark, Button, Card, Field, Notice, RowLink, SectionTitle } from '../components/UI';
import { DocumentDelivery } from '../components/DocumentDelivery';
import { colors, radius } from '../theme';
import { useLanguage } from '../LanguageContext';
import { conditionMatches, mapI90Answers, QuestionnaireValidationError } from '../uscisQuestionnaire';
import { activePreparationQuestions, activePreparationAnswers, fillGuidedPreparationPdf, getPreparationDefinition, preparationQuestionForPdfField, preparationSigning, validatePreparationQuestion, type PreparationField } from '../guidedPreparation';
import { FreePdfValidationError } from '../freePdfEngine';
import { loadFreePdfTemplate } from '../freePdfTemplates';
import { fillOfficialPrintPdf, PrintValidationError } from '../pdfEngine';
import { loadPrintTemplate, PrintableDocument } from '../officialPdfDocument';
import { useCloudSession } from '../cloudClient';
import { downloadReviewDocument, listMyReviews, submitFormReview, type ReviewSubmission } from '../formReview';
import { saveDraft, type SavedDraft } from '../draftStorage';
import { fullPreparationProgress, validCompletedQuestions } from '../fullPreparationDraft';
import type { DraftSummary, QualificationAnswer } from '../types';

type Answers = Record<string, string | string[]>;
type FormField = PreparationField;
type Stage = 'intro' | 'questions' | 'review' | 'submitted' | 'document';
type PreparedSubmission = { requestId: string; formId: string; pdfBytes: Uint8Array; answers: Answers; fingerprint: string };

type Props = {
  formId?: string;
  reviewRequired?: boolean;
  onExit: () => void;
  onAccount?: () => void;
  draftOwner?: string | null;
  onExitToApplications?: () => void;
  applicationReturnRequest?: number;
  isActive: boolean;
  initialDraft?: SavedDraft;
  checks: Record<string, QualificationAnswer>;
  onDraftSaved?: (draft: DraftSummary) => void;
  onSaveErrorChange?: (failed: boolean) => void;
};

export function FullFormPreparationScreen({ formId = 'I-90', reviewRequired = false, onExit, onAccount, onExitToApplications, applicationReturnRequest, draftOwner, isActive, initialDraft, checks, onDraftSaved, onSaveErrorChange }: Props) {
  const { t } = useLanguage();
  const session = useCloudSession();
  const accountId = session.user?.id;
  const sessionRef = useRef(accountId);
  sessionRef.current = accountId;
  const authorized = !!accountId && draftOwner === accountId;
  const definition = getPreparationDefinition(formId);
  const matchingDraft = initialDraft?.formId === formId ? initialDraft : undefined;
  const continuingQuestionnaire = matchingDraft?.stage === 'fullPreparation' || !!matchingDraft?.fullAnswers;
  const [answers, setAnswers] = useState<Answers>(() => matchingDraft?.fullAnswers || {});
  const [completedQuestionIds, setCompletedQuestionIds] = useState<string[]>(() => validCompletedQuestions(answers, matchingDraft?.completedQuestionIds || [], formId));
  const [stage, setStage] = useState<Stage>(() => continuingQuestionnaire ? fullPreparationProgress(answers, completedQuestionIds, formId).firstIncomplete ? 'questions' : 'review' : 'intro');
  const [questionId, setQuestionId] = useState(() => fullPreparationProgress(answers, completedQuestionIds, formId).firstIncomplete?.id || definition.questions[0].id);
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorQuestion, setErrorQuestion] = useState<string>();
  const [document, setDocument] = useState<PrintableDocument>();
  const [review, setReview] = useState<ReviewSubmission>();
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [documentSubmission, setDocumentSubmission] = useState<ReviewSubmission>();
  const preparedSubmission = useRef<PreparedSubmission | undefined>(undefined);
  const reviewRequest = useRef(0);
  const [revision, setRevision] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const handledApplicationReturn = useRef(applicationReturnRequest);
  const exitTarget = useRef(onExit);
  const exiting = useRef(false);
  const [picker, setPicker] = useState<FormField>();
  const [search, setSearch] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>(matchingDraft ? 'saved' : 'idle');
  const [saveError, setSaveError] = useState('');
  const scroll = useRef<ScrollView>(null);
  const documentRef = useRef<PrintableDocument | undefined>(undefined);
  const generation = useRef(0);
  const documentRequest = useRef(0);
  const openingDocument = useRef(false);
  const busyRef = useRef(false);
  const answersRef = useRef(answers);
  const completedRef = useRef(completedQuestionIds);
  const saveRevision = useRef(0);
  const latestSave = useRef<Promise<boolean>>(Promise.resolve(true));
  const questions = useMemo(() => activePreparationQuestions(formId, answers), [formId, answers]);
  const index = Math.max(0, questions.findIndex(item => item.id === questionId));
  const question = questions[index];
  const progress = fullPreparationProgress(answers, completedQuestionIds, formId);
  const hasAnswers = Object.values(answers).some(value => Array.isArray(value) ? value.length > 0 : !!value.trim());

  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [stage, questionId]);
  useEffect(() => () => { generation.current += 1; documentRequest.current += 1; reviewRequest.current += 1; documentRef.current?.dispose(); }, []);
  useEffect(() => {
    // The account shell normally remounts this screen. Also clear owned review
    // artifacts here so a session transition cannot retain another account's PDF.
    generation.current += 1; documentRequest.current += 1; openingDocument.current = false; preparedSubmission.current = undefined;
    busyRef.current = false; setBusy(false);
    documentRef.current?.dispose(); documentRef.current = undefined; setDocument(undefined); setDocumentSubmission(undefined);
    setReview(undefined); setReviewLoaded(false); setReviewError(''); setReviewLoading(false);
    setStage(current => current === 'document' ? 'review' : current);
  }, [accountId, authorized]);
  function closeDocument() {
    documentRequest.current += 1;
    if (openingDocument.current) { openingDocument.current = false; busyRef.current = false; setBusy(false); }
    documentRef.current?.dispose(); documentRef.current = undefined; setDocument(undefined); setDocumentSubmission(undefined);
    setStage(current => current === 'document' ? 'submitted' : current);
  }
  async function refreshReview() {
    if (!authorized) return;
    const request = ++reviewRequest.current;
    const owner = accountId;
    setReviewLoading(true); setReviewLoaded(false); setReviewError('');
    closeDocument();
    try {
      const all = await listMyReviews();
      if (request !== reviewRequest.current || sessionRef.current !== owner) return;
      const latest = all.filter(item => item.formId === formId && item.caseId === (matchingDraft?.paymentCaseId || null) && item.status !== 'superseded')
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
      setReview(latest); setReviewLoaded(true);
    } catch {
      if (request === reviewRequest.current && sessionRef.current === owner) {
        setReviewLoaded(false); setReviewError('The review status could not be checked. Please try again.');
      }
    } finally { if (request === reviewRequest.current) setReviewLoading(false); }
  }
  useEffect(() => {
    if (isActive && authorized) void refreshReview();
    else if (!isActive) { closeDocument(); setReviewLoaded(false); }
    return () => { reviewRequest.current += 1; };
  }, [isActive, accountId, authorized, formId, matchingDraft?.paymentCaseId]);
  useEffect(() => {
    onSaveErrorChange?.(saveState === 'failed');
    return () => onSaveErrorChange?.(false);
  }, [saveState, onSaveErrorChange]);
  useEffect(() => {
    if (Platform.OS !== 'web' || (saveState !== 'saving' && saveState !== 'failed')) return;
    const preventAccidentalExit = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventAccidentalExit);
    return () => window.removeEventListener('beforeunload', preventAccidentalExit);
  }, [saveState]);

  async function exit(destination = onExit) {
    if (busyRef.current || exiting.current) return;
    exitTarget.current = destination;
    exiting.current = true;
    // Let writes already started by input handlers finish before unmounting.
    let operation: Promise<boolean>;
    let saved: boolean;
    do { operation = latestSave.current; saved = await operation; } while (operation !== latestSave.current);
    if (saved) { setLeaving(false); destination(); } else setLeaving(true);
    exiting.current = false;
  }
  useEffect(() => {
    if (applicationReturnRequest === handledApplicationReturn.current || busy) return;
    handledApplicationReturn.current = applicationReturnRequest;
    if (onExitToApplications) void exit(onExitToApplications);
  }, [applicationReturnRequest, busy, onExitToApplications]);
  function back() {
    if (busyRef.current) return true;
    if (picker) { setPicker(undefined); return true; }
    if (leaving) { setLeaving(false); return true; }
    if (stage === 'document') setStage('submitted');
    else if (stage === 'submitted') setStage('review');
    else if (stage === 'review') { setEditing(false); setQuestionId(questions[questions.length - 1].id); setStage('questions'); }
    else if (stage === 'questions') {
      setErrors({});
      if (editing) { setEditing(false); setStage('review'); }
      else if (index > 0) setQuestionId(questions[index - 1].id);
      else setStage('intro');
    } else void exit();
    return true;
  }
  useEffect(() => {
    if (!isActive) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', back);
    return () => subscription.remove();
  }, [isActive, stage, questionId, editing, picker, leaving, answers]);

  function persist(nextAnswers: Answers, completed: string[]): Promise<boolean> {
    const progress = fullPreparationProgress(nextAnswers, completed, formId);
    const draft: SavedDraft = {
      version: 1, formId, title: definition.title,
      mode: 'ai', stage: 'fullPreparation', answers: matchingDraft?.answers || {}, checks,
      paymentCaseId: matchingDraft?.paymentCaseId, paymentParentCaseId: matchingDraft?.paymentParentCaseId,
      fullAnswers: nextAnswers, completedQuestionIds: completed,
      answered: progress.answered, total: progress.questions.length, updatedAt: new Date().toISOString(),
    };
    const request = ++saveRevision.current;
    setSaveState('saving'); setSaveError('');
    const operation = saveDraft(draft, draftOwner).then(() => {
      if (request === saveRevision.current) { setSaveState('saved'); onDraftSaved?.(draft); }
      return true;
    }, cause => {
      if (request === saveRevision.current) {
        setSaveState('failed');
        setSaveError(cause instanceof Error ? cause.message : 'Your latest answers could not be saved. Please retry before leaving.');
      }
      return false;
    });
    latestSave.current = operation;
    return operation;
  }
  function update(fieldId: string, value: string | string[]) {
    if (busyRef.current) return;
    const nextAnswers = { ...answersRef.current, [fieldId]: value };
    preparedSubmission.current = undefined;
    const changedQuestion = definition.questions.find(item => item.fields.some(field => field.id === fieldId));
    const completed = validCompletedQuestions(nextAnswers, completedRef.current.filter(id => id !== changedQuestion?.id), formId);
    answersRef.current = nextAnswers; completedRef.current = completed;
    setAnswers(nextAnswers); setCompletedQuestionIds(completed);
    void persist(nextAnswers, completed);
    setErrors({}); setConfirmed(false); setError(''); setErrorQuestion(undefined);
    documentRef.current?.dispose(); documentRef.current = undefined; setDocument(undefined);
  }
  function next() {
    const invalid = validatePreparationQuestion(formId, question, answersRef.current);
    setErrors(invalid);
    if (Object.keys(invalid).length) return;
    const completed = validCompletedQuestions(answersRef.current, [...completedRef.current, question.id], formId);
    completedRef.current = completed; setCompletedQuestionIds(completed);
    void persist(answersRef.current, completed);
    if (editing || index === questions.length - 1) { setEditing(false); setStage('review'); }
    else setQuestionId(questions[index + 1].id);
  }
  function edit(id: string) { setQuestionId(id); setEditing(true); setErrors({}); setStage('questions'); }
  async function submit() {
    if (!confirmed || busyRef.current || !authorized || !reviewLoaded || reviewLoading) return;
    const incomplete = fullPreparationProgress(answersRef.current, completedRef.current, formId).firstIncomplete;
    if (incomplete) {
      setQuestionId(incomplete.id); setEditing(false); setStage('questions');
      setError('Finish each question before sending your form for review.'); return;
    }
    for (const item of questions) {
      const invalid = validatePreparationQuestion(formId, item, answers);
      if (Object.keys(invalid).length) { edit(item.id); setErrors(invalid); return; }
    }
    busyRef.current = true; setBusy(true); setError(''); setErrorQuestion(undefined);
    const request = ++generation.current;
    try {
      if (!await persist(answersRef.current, completedRef.current)) {
        setError('Save your latest answers before sending your form for review.'); return;
      }
      if (request !== generation.current || sessionRef.current !== accountId) return;
      const snapshot = activePreparationAnswers(formId, answersRef.current);
      const fingerprint = JSON.stringify(snapshot);
      let prepared = preparedSubmission.current;
      if (!prepared || prepared.fingerprint !== fingerprint) {
        let bytes: Uint8Array;
        if (formId === 'I-90') {
          const mapped = mapI90Answers(snapshot);
          const template = await loadPrintTemplate(require('../../assets/uscis-print/i-90.pdf'));
          bytes = await fillOfficialPrintPdf(template, mapped.definition, mapped.answers);
        } else bytes = await fillGuidedPreparationPdf(formId, await loadFreePdfTemplate(formId), snapshot);
        if (request !== generation.current || sessionRef.current !== accountId) return;
        prepared = { requestId: randomUUID(), formId, pdfBytes: bytes, answers: snapshot, fingerprint };
        preparedSubmission.current = prepared;
      }
      // Keep these exact bytes and this id after an uncertain response. Retrying
      // must not create another revision or another PDF with a different hash.
      const { requestId, pdfBytes, answers: submittedAnswers } = prepared;
      const result = await submitFormReview({ requestId, formId, pdfBytes, answers: submittedAnswers, caseId: matchingDraft?.paymentCaseId });
      if (request !== generation.current || sessionRef.current !== accountId) return;
      reviewRequest.current += 1; setReviewLoading(false); setReviewError('');
      documentRef.current?.dispose(); documentRef.current = undefined; setDocument(undefined); setDocumentSubmission(undefined);
      setReview(result); setReviewLoaded(true); setConfirmed(false); setStage('submitted');
      if (result.status === 'superseded') await refreshReview();
    } catch (cause) {
      if (request !== generation.current) return;
      const missingExplanation = formId === 'I-90' && cause instanceof QuestionnaireValidationError && (cause.errors.removal_history || cause.errors.abandonment_history);
      const linkedQuestion = missingExplanation ? questions.find(item => item.id.startsWith('additional-') && item.fields.every(field => !answers[field.id])) || questions.find(item => item.id === 'additional-1')
        : (cause instanceof PrintValidationError || cause instanceof FreePdfValidationError) && cause.fieldName ? preparationQuestionForPdfField(formId, cause.fieldName)
        : cause instanceof QuestionnaireValidationError ? questions.find(item => item.fields.some(field => !!cause.errors[field.id])) : undefined;
      setErrorQuestion(linkedQuestion?.id);
      setError(cause instanceof PrintValidationError || cause instanceof FreePdfValidationError || cause instanceof QuestionnaireValidationError ? cause.message : 'Your form could not be sent for review. Your answers are still here. Retry to send the same version.');
    } finally { if (request === generation.current) { busyRef.current = false; setBusy(false); } }
  }

  async function openApprovedDocument() {
    if (!isActive || busyRef.current || !authorized || !reviewLoaded || reviewLoading || review?.status !== 'approved') return;
    busyRef.current = true; openingDocument.current = true; setBusy(true); setError('');
    const request = ++documentRequest.current;
    const approved = review;
    try {
      // Only the server-approved artifact is deliverable. Local answers are
      // deliberately absent from this code path, including after local edits.
      const result = await downloadReviewDocument(approved);
      if (request !== documentRequest.current || sessionRef.current !== accountId) { result.dispose(); return; }
      documentRef.current?.dispose(); documentRef.current = result; setDocument(result);
      setDocumentSubmission(approved); setRevision(value => value + 1); setStage('document');
    } catch {
      if (request === documentRequest.current && sessionRef.current === accountId) {
        setError('The approved PDF could not be opened. Refresh the review status and try again.');
        await refreshReview();
      }
    } finally { if (request === documentRequest.current) { openingDocument.current = false; busyRef.current = false; setBusy(false); } }
  }
  async function signInForReview() {
    if (!onAccount || busyRef.current) return;
    if (await persist(answersRef.current, completedRef.current)) await exit(onAccount);
  }
  function reviewStatus() {
    if (!authorized) return null;
    return <Card>
      <Text style={styles.label}>{t('FillOut team review')}</Text>
      {reviewLoading && <Text accessibilityLiveRegion="polite" style={styles.body}>{t('Checking review status…')}</Text>}
      {!!reviewError && <Text accessibilityRole="alert" style={styles.error}>{t(reviewError)}</Text>}
      {reviewLoaded && review && <>
        {review.environment === 'sandbox' && <Notice title={t('Test submission')}>{t('Sample information only. This form is for testing and must not be filed.')}</Notice>}
        <Badge gold={review.status !== 'approved'}>{t(review.status === 'approved' ? review.environment === 'sandbox' ? 'Test review approved' : 'Approved for download' : review.status === 'changes_requested' ? 'Changes requested' : 'In review')}</Badge>
        <Text style={styles.caption}>{t('Submitted version: {date}', { date: new Date(review.submittedAt).toLocaleString() })}</Text>
        {review.status === 'pending' && <Text style={styles.body}>{t('Your form is with the FillOut team. Download and print will become available after approval.')}</Text>}
        {review.status === 'changes_requested' && <Text style={styles.body}>{t('Read the feedback, update your answers, and send a new version for review.')}</Text>}
        {!!review.reviewNote && <Notice title={t('Team feedback')}>{review.reviewNote}</Notice>}
        {review.status === 'approved' && <>
          <Text style={styles.body}>{t('This approval applies to the submitted version only. Changes to your draft need a new review.')}</Text>
          <Button title={t(busy ? 'Opening approved PDF…' : review.environment === 'sandbox' ? 'Open test PDF' : 'Open approved PDF')} variant="gold" icon="document-text-outline" disabled={busy || reviewLoading} onPress={() => void openApprovedDocument()} />
        </>}
      </>}
      {reviewLoaded && !review && <Text style={styles.body}>{t('Complete the questionnaire and send it to the FillOut team. Download and print unlock after approval.')}</Text>}
      <Button title={t('Refresh review status')} variant="quiet" icon="refresh-outline" disabled={busy || reviewLoading} onPress={() => void refreshReview()} />
    </Card>;
  }

  function answerLabel(field: FormField): string {
    const value = answers[field.id];
    if (!value || (Array.isArray(value) && !value.length)) return t('Left blank');
    const values = Array.isArray(value) ? value : [value];
    return values.map(item => (field.options?.find(option => option.value === item) ? t(field.options.find(option => option.value === item)!.label) : item)).join(', ');
  }
  function control(field: FormField) {
    const selected = answers[field.id];
    const required = field.required || (!!field.requiredWhen && conditionMatches(field.requiredWhen, activePreparationAnswers(formId, answers)));
    const title = `${t(field.label)}${formId !== 'I-90' || required || /if applicable|if any|optional/i.test(field.label) ? '' : t(' · if applicable')}`;
    if (field.type === 'select') return <View key={field.id} style={styles.field}>
      <Text style={styles.label}>{title}</Text>
      <Button title={selected ? answerLabel(field) : t('Choose an answer')} accessibilityLabel={title} variant="secondary" icon="chevron-down" onPress={() => { setSearch(''); setPicker(field); }} />
      {!!field.help && <Text style={styles.caption}>{t(field.help)}</Text>}
      {!!errors[field.id] && <Text accessibilityRole="alert" style={styles.error}>{t(errors[field.id])}</Text>}
    </View>;
    if (field.type === 'radio' || field.type === 'multiselect') return <View key={field.id} style={styles.field}>
      <Text style={styles.label}>{title}</Text>
      {field.options?.map(option => {
        const multi = field.type === 'multiselect';
        const checked = multi ? Array.isArray(selected) && selected.includes(option.value) : selected === option.value;
        return <Pressable key={option.value} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked }} accessibilityLabel={t(option.label)} style={[styles.option, checked && styles.selected]} onPress={() => {
          if (!multi) update(field.id, option.value);
          else { const values = Array.isArray(selected) ? selected : []; update(field.id, checked ? values.filter(value => value !== option.value) : [...values, option.value]); }
        }}><Ionicons name={multi ? checked ? 'checkbox' : 'square-outline' : checked ? 'radio-button-on' : 'radio-button-off'} size={22} color={colors.navy} /><Text style={styles.optionText}>{t(option.label)}</Text></Pressable>;
      })}
      {!field.required && !!selected && <Button title={t('Clear selection')} variant="quiet" onPress={() => update(field.id, field.type === 'multiselect' ? [] : '')} />}
      {!!field.help && <Text style={styles.caption}>{t(field.help)}</Text>}
      {!!errors[field.id] && <Text accessibilityRole="alert" style={styles.error}>{t(errors[field.id])}</Text>}
    </View>;
    return <View key={field.id} style={styles.field}><Field label={title} value={typeof selected === 'string' ? selected : ''} onChangeText={value => update(field.id, value)} multiline={field.type === 'textarea'} autoCorrect={false} autoCapitalize="none" placeholder={field.type === 'date' ? t('MM/DD/YYYY') : t('Enter your answer')} keyboardType={field.type === 'date' ? 'numbers-and-punctuation' : 'default'} error={errors[field.id] ? t(errors[field.id]) : undefined} />{!!field.help && <Text style={styles.caption}>{t(field.help)}</Text>}</View>;
  }

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.scroll}>
      <View style={styles.content}>
        <Pressable accessibilityRole="button" accessibilityLabel={t(stage === 'intro' ? 'Preparation options' : 'Back')} disabled={busy} onPress={back} style={styles.back}><Ionicons name="arrow-back" size={21} color={colors.navy} /><Text style={styles.label}>{t(stage === 'intro' ? 'Preparation options' : 'Back')}</Text></Pressable>
        <Badge gold>{formId} · {t(stage === 'document' ? 'PRINT & SIGN' : 'GUIDED PREPARATION')}</Badge>
        {(stage === 'intro' || stage === 'review' || stage === 'submitted') && reviewStatus()}
        <Text style={styles.caption}>{t('The official USCIS form remains in English. Enter answers in English as required by the instructions.')}</Text>
        {reviewRequired && stage !== 'questions' && <Notice tone="warning">{t('This form still needs individual review. You can fill out a draft, but this check has not confirmed a filing path. Review the current official guidance before filing.')}</Notice>}
        {stage === 'intro' && <>
          <BrandMark compact /><SectionTitle title={t('Your answers. Your official form.')} subtitle={t('Complete the {formId} questions and send your form to the FillOut team for review. Download and print become available after approval.', { formId })} />
          <Card><Text style={styles.label}>{t('What you’ll prepare')}</Text><Text style={styles.body}>{t(formId === 'I-90' ? 'Applicant information, your reason for applying, processing details, interpreter or preparer information when applicable, and additional information.' : definition.generalHelp)}</Text><Text style={styles.body}>{t('Signatures stay blank for signing after you print.')} {t('The form uses edition {edition}.', { edition: definition.edition })}</Text></Card>
          <Notice title={t('Your progress is saved')}>{t(formId === 'I-90' ? 'Your answers are saved on this device as you go. Continue from Saved drafts at the next unanswered question. Explanations are based on the official instructions.' : 'Your answers are saved on this device as you go. Continue from Saved drafts at the next unanswered question. The questions follow the official form wording and page references.')}</Notice>
          <Button title={hasAnswers ? t('Continue my answers') : formId === 'I-90' ? t('Start I-90 questions') : t('Start {formId} questions', { formId })} variant="gold" icon="arrow-forward" onPress={() => setStage('questions')} />
          <Button title={formId === 'I-90' ? t('Read official I-90 instructions') : t('Read official {formId} instructions', { formId })} variant="secondary" icon="open-outline" onPress={() => { void Linking.openURL(definition.instructionsUrl).catch(() => setError('The instructions could not be opened. Please try again.')); }} />
        </>}
        {stage === 'questions' && question && <>
          <View style={styles.row}><Text style={styles.caption}>{editing ? t('Edit answer') : t('Question {current} of {total}', { current: index + 1, total: questions.length })}</Text><Text style={styles.caption}>{formId === 'I-90' ? t('Part {part} · Item {item}', { part: question.part, item: question.item }) : t('Official form · Page {page}', { page: question.source.formPages[0] })}</Text></View>
          <View style={styles.track}><View style={[styles.fill, { width: `${(index + 1) / questions.length * 100}%` }]} /></View>
          {(formId === 'I-90' || question.fields.length > 1) && <SectionTitle title={t(question.title)} />}
          {question.fields.map(control)}
          <Notice title={t('About this question')}>{formId === 'I-90' ? t(question.help) : t('These entries appear on page {page} of the official {formId} form. Follow the printed directions and leave an entry blank only when the form says it does not apply.', { page: question.source.formPages[0], formId })}</Notice>
          <Button title={t(editing ? 'Update answer' : index === questions.length - 1 ? 'Review all answers' : 'Next question')} variant="gold" icon="arrow-forward" onPress={next} />
          <Button title={t('Review progress')} variant="quiet" onPress={() => setStage('review')} />
        </>}
        {stage === 'review' && <>
          <SectionTitle title={formId === 'I-90' ? t('Review your I-90') : t('Review your {formId}', { formId })} subtitle={t('Check every answer. Tap a question to make a correction.')} />
          <Card>{questions.map(item => <RowLink key={item.id} title={formId === 'I-90' ? t('Part {part} · {title}', { part: item.part, title: t(item.title) }) : t('Page {page} · {title}', { page: item.source.formPages[0], title: t(item.title) })} subtitle={item.fields.map(field => `${t(field.label)}: ${answerLabel(field)}`).join('\n')} icon="create-outline" onPress={() => { if (!busy) edit(item.id); }} />)}</Card>
          <Notice title={t('After printing')}>{preparationSigning(formId, answers).map(item => t(item)).join('\n\n') || t('Review the official instructions before filing your completed form.')}</Notice>
          {!!progress.firstIncomplete && <Notice tone="warning">
            <Text style={styles.body}>{t('Finish each question before sending your form for review.')}</Text>
            <Button title={t('Continue unanswered questions')} variant="secondary" onPress={() => { setEditing(false); setQuestionId(progress.firstIncomplete!.id); setStage('questions'); }} />
          </Notice>}
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed, disabled: busy }} disabled={busy} onPress={() => setConfirmed(!confirmed)} style={styles.option}><Ionicons name={confirmed ? 'checkbox' : 'square-outline'} size={24} color={colors.navy} /><Text style={styles.optionText}>{t(review ? 'I agree to send these answers and this PDF to the FillOut team as a new version for review. This replaces my earlier submission and needs a new approval.' : 'I have checked my answers and agree to send them and the completed PDF to the FillOut team for review.')}</Text></Pressable>
          {!authorized ? <>
            <Notice>{t('Sign in to send your form for review and receive the approved PDF. Your draft stays saved on this device.')}</Notice>
            {onAccount && <Button title={t('Sign in to send for review')} disabled={busy || session.loading} variant="gold" onPress={() => void signInForReview()} />}
          </> : <Button title={t(busy ? 'Sending for review…' : review ? 'Send a new version for review' : 'Send for review')} disabled={!confirmed || busy || !!progress.firstIncomplete || !reviewLoaded || reviewLoading} variant="gold" icon="send-outline" onPress={() => void submit()} />}
          <Text style={styles.caption}>{t('Sending to FillOut does not file your application with USCIS. Download and print stay locked until the team approves the submitted version.')}</Text>
        </>}
        {stage === 'submitted' && <>
          <SectionTitle title={t('Your form review')} subtitle={t('You can check the review status here or in My Application.')} />
          <Button title={t('Edit my answers')} variant="secondary" icon="create-outline" disabled={busy} onPress={() => setStage('review')} />
        </>}
        {stage === 'document' && isActive && authorized && reviewLoaded && document && documentSubmission && <>
          <SectionTitle title={t('Approved {formId}', { formId })} subtitle={t('Download the official form with your answers, print it, and sign where required.')} />
          <Notice title={t('Approved submitted version')}>{t('Submitted version: {date}', { date: new Date(documentSubmission.submittedAt).toLocaleString() }) + '\n' + t('This file contains the answers the team reviewed. Later edits to your local draft are not included.')}</Notice>
          <DocumentDelivery testDocument={documentSubmission.environment === 'sandbox'} formId={formId} pdfReady documentRevision={String(revision)} onDownloadPdf={document.download} onPrintPdf={document.print} onSharePdf={document.share} />
          <Button title={t('Edit my answers')} variant="secondary" icon="create-outline" onPress={() => setStage('review')} />
        </>}
        {!!error && <Notice tone="warning"><Text accessibilityRole="alert" style={styles.error}>{errorQuestion ? `${t(definition.questions.find(item => item.id === errorQuestion)?.title || '')}: ` : ''}{t(error)}</Text>{errorQuestion && <Button title={t('Review this answer')} variant="secondary" onPress={() => edit(errorQuestion)} />}</Notice>}
        {saveState === 'failed' ? <Notice tone="warning" title={t('Draft not saved')}><Text accessibilityRole="alert" style={styles.error}>{t(saveError)}</Text><Button title={t('Retry save')} variant="secondary" onPress={() => void persist(answersRef.current, completedRef.current)} /></Notice>
          : saveState !== 'idle' && <Text accessibilityLiveRegion="polite" style={styles.caption}>{t(saveState === 'saving' ? 'Saving draft…' : 'Saved to drafts on this device')}</Text>}
        {hasAnswers && stage !== 'intro' && <Button title={t('Leave this form')} disabled={busy} variant="quiet" onPress={() => void exit()} />}
      </View>
    </ScrollView>
    <Modal visible={isActive && !!picker} animationType="slide" transparent onRequestClose={() => setPicker(undefined)}>
      <View style={styles.overlay}><View style={styles.sheet} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={styles.label}>{picker ? t(picker.label) : ''}</Text>
        <Field label={t('Search choices')} value={search} onChangeText={setSearch} autoCapitalize="none" />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.field}>
          {picker?.options?.filter(option => `${t(option.label)} ${option.label} ${option.value}`.toLowerCase().includes(search.toLowerCase())).map(option => <RowLink key={option.value} title={t(option.label)} onPress={() => { update(picker.id, option.value); setPicker(undefined); }} />)}
        </ScrollView>
        {picker && !picker.required && <Button title={t('Leave blank')} variant="secondary" onPress={() => { update(picker.id, ''); setPicker(undefined); }} />}
        <Button title={t('Close choices')} variant="quiet" onPress={() => setPicker(undefined)} />
      </View></View>
    </Modal>
    <Modal visible={isActive && leaving} animationType="fade" transparent onRequestClose={() => setLeaving(false)}>
      <View style={styles.overlay}><Card style={styles.exitCard}><SectionTitle title={t('Save your latest answers')} subtitle={t('Your latest changes could not be saved. Retry saving before leaving so you can continue later.')} /><Button title={t('Keep working')} onPress={() => setLeaving(false)} /><Button title={t(saveState === 'saving' ? 'Saving draft…' : 'Retry save and leave')} disabled={saveState === 'saving'} variant="secondary" onPress={() => { void persist(answersRef.current, completedRef.current).then(saved => { if (saved) void exit(exitTarget.current); }); }} /></Card></View>
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
