import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useLanguage } from '../LanguageContext';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, Alert, BackHandler, Image, ImageBackground, KeyboardAvoidingView, Linking, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { AiPaymentGate } from '../components/AiPaymentGate';
import { getAiPaymentKind } from '../payments';
import { Badge, BrandMark, Button, Card, Field, Notice, RowLink, SectionTitle } from '../components/UI';
import { colors, radius } from '../theme';
import { draftProgress, draftResume, evaluateQualification, matchesFormSearch, validateField } from '../qualification';
import { loadDraft, saveDraft, SavedDraft } from '../draftStorage';
import { EmailAccess } from '../components/EmailAccess';
import { submitRequest, useRequestDelivery, useRequestIdentity, type RequestReceipt } from '../requestDelivery';
import { DraftSummary, FormRecord, PreparationField, PreparationMode, QualificationAnswer, QualificationSchema } from '../types';
import catalogFile from '../../data/forms-catalog.json';
import finderFile from '../../data/form-finder.json';
import pricingFile from '../../data/form-pricing.json';
import attorneyFile from '../../data/attorney-pricing.json';
import mainChecksFile from '../../data/eligibility-main.json';
import otherChecksFile from '../../data/eligibility-other.json';
import interviewFile from '../../data/preparation-fields.json';
import { FullFormPreparationScreen } from './FullFormPreparationScreen';
import { FreeFormPreparationScreen } from './FreeFormPreparationScreen';

type Route = 'home' | 'catalog' | 'finder' | 'detail' | 'check' | 'result' | 'aiIntro' | 'fullPreparation' | 'freePreparation' | 'interview' | 'interviewReview' | 'attorney' | 'attorneyPreview';
type PickerKind = 'status' | 'goal' | null;
type Props = {
  onContact: () => void;
  onAccount?: () => void;
  draftOwner?: string | null;
  onDraftSaved?: (draft: DraftSummary) => void;
  isActive?: boolean;
  initialFormId?: string;
  resumeFormId?: string;
  resumeRequest?: number;
  applicationReturnRequest?: number;
  onOpenApplicationForm?: (formId: string) => void;
  onExitToApplications?: () => void;
  onFullSessionActiveChange?: (active: boolean) => void;
  onSaveErrorChange?: (failed: boolean) => void;
};

const forms = catalogFile.forms as FormRecord[];
const checks = [...mainChecksFile.forms, ...otherChecksFile.forms] as QualificationSchema[];
const finder: any = finderFile;
const pricing: any = pricingFile;
const attorneys: any = attorneyFile;
const interviews: any = interviewFile;
const modeNames: Record<PreparationMode, string> = { self: 'Do it yourself', ai: 'Prepare with FillOut', attorney: 'Attorney contact request' };
const categories = ['All', ...Array.from(new Set(forms.map(form => form.category)))];
const mainFormIds = ['N-400', 'I-90', 'I-130', 'I-485', 'I-765', 'I-751', 'I-129F', 'I-864'];
const formLabels: Record<string, string> = {
  'AR-11': 'Change of address', 'G-1145': 'Receipt notifications', 'G-639': 'Immigration records (FOIA)',
  'I-90': 'Renew or replace a green card', 'I-129F': 'Fiancé(e) petition', 'I-130': 'Family petition',
  'I-130A': 'Spouse information', 'I-131': 'Travel document', 'I-131A': 'Carrier documentation',
  'I-134': 'Financial support', 'I-485': 'Adjustment of status', 'I-751': 'Remove green card conditions',
  'I-765': 'Work permit', 'I-765WS': 'Work permit worksheet', 'I-821': 'Temporary Protected Status',
  'I-821D': 'DACA', 'I-864': 'Affidavit of support', 'I-864A': 'Household member support',
  'N-400': 'U.S. citizenship', 'N-565': 'Replace a citizenship document', 'N-600': 'Certificate of citizenship',
};
const attorneyScope: Record<string, string> = {
  'I-90': 'Replacement', 'I-129F': 'Petition stage', 'I-130': 'Petition only', 'I-485': 'Standalone filing',
  'I-751': 'Joint petition', 'I-131': 'Reentry permit', 'I-821D': 'Renewal with work permit', 'G-639': 'Request and records review',
};
const money = (amount: number | null | undefined) => typeof amount === 'number' ? '$' + Math.round(amount).toLocaleString('en-US') : 'Quote required';

// These two checks intentionally end in policy review even on the ordinary
// renewal path. Permit an explicitly requested draft without turning review
// into a passed eligibility result, or bypassing earlier concerns/uncertainty.
function allowsReviewDraft(id: string, mode: PreparationMode, schema: QualificationSchema | undefined, answers: Record<string, QualificationAnswer>) {
  const lastId = id === 'I-821' ? 'case-review' : id === 'I-821D' ? 'individual-review' : null;
  if (mode !== 'ai' || !lastId || !schema?.questions.length) return false;
  const last = schema.questions.at(-1)!;
  return last.id === lastId && last.no === 'review' && answers[last.id] === 'no'
    && evaluateQualification(schema, answers).status === 'review'
    && schema.questions.slice(0,-1).every(item => {
      const answer = answers[item.id]; return (answer === 'yes' || answer === 'no') && item[answer] === 'next';
    });
}

function aiOffer(id: string) {
  const item = pricing.forms.find((record: any) => record.id === id);
  const reference = item.citizenPath;
  const target = reference.includedWith?.[0] || reference.requiredPackage;
  const parent = target ? pricing.forms.find((record: any) => record.id === target) : undefined;
  const amount = item.eagleAi.serviceAmountUsd30;
  if (reference.status === 'not-offered') return { price: 'Ask our team', note: 'Availability needs confirmation', unavailable: true, target: null };
  if (reference.status === 'included') return { price: 'Included', note: `Included in ${target}`, unavailable: false, target };
  if (reference.status === 'add-on') return { price: 'Price at checkout', note: `Add-on to ${target}`, unavailable: false, target };
  return { price: amount === 0 ? 'Free' : 'Price at checkout', note: amount === 0 ? 'No preparation charge' : 'One payment per application', unavailable: false, target: null };
}

async function openOfficial(url: string | null | undefined, t: (text: string) => string) {
  if (!url) return;
  try { await Linking.openURL(url); }
  catch { Alert.alert(t('Unable to open this link'), t('Please try again when your connection is available.')); }
}

export function FormsFlow({ onContact, onAccount, draftOwner, onDraftSaved, isActive = true, initialFormId, resumeFormId, resumeRequest, applicationReturnRequest, onOpenApplicationForm, onExitToApplications, onFullSessionActiveChange, onSaveErrorChange }: Props) {
  const { t, language } = useLanguage();
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = Math.min(windowWidth, 600) - 40;
  const initialForm = forms.find(item => item.id === initialFormId);
  const [route, setRoute] = useState<Route>(initialForm ? 'detail' : 'home');
  const [returnTo, setReturnTo] = useState<Route>('home');
  const [formId, setFormId] = useState(initialForm?.id || 'N-400');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [otherFormsOpen, setOtherFormsOpen] = useState(false);
  const [statusId, setStatusId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [finderMatchesVisible, setFinderMatchesVisible] = useState(false);
  const [picker, setPicker] = useState<PickerKind>(null);
  const [guaranteeOpen, setGuaranteeOpen] = useState(false);
  const [mode, setMode] = useState<PreparationMode>('self');
  const [answers, setAnswers] = useState<Record<string, QualificationAnswer>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [showCheckAnswers, setShowCheckAnswers] = useState(false);
  const [initialDraft, setInitialDraft] = useState<SavedDraft>();
  const [preparationVersion, setPreparationVersion] = useState(0);
  const [completedFieldIds, setCompletedFieldIds] = useState<string[]>([]);
  const latestDraft = useRef<SavedDraft | undefined>(undefined);
  const saveGeneration = useRef(0);
  const latestSave = useRef<Promise<boolean>>(Promise.resolve(true));
  const returningToApplications = useRef(false);
  const handledApplicationReturn = useRef(applicationReturnRequest);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [fieldIndex, setFieldIndex] = useState(0);
  const [fieldError, setFieldError] = useState('');
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftFinished, setDraftFinished] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [draftError, setDraftError] = useState('');
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [resumeError, setResumeError] = useState('');
  const [resumeAttempt, setResumeAttempt] = useState(0);
  const [lawyer, setLawyer] = useState({ name: '', email: '', phone: '', note: '' });
  const [lawyerErrors, setLawyerErrors] = useState<Record<string, string>>({});
  const [sendingRequest, setSendingRequest] = useState(false);
  const [requestReceipt, setRequestReceipt] = useState<RequestReceipt | null>(null);
  const [requestError, setRequestError] = useState('');
  const [attorneyConsent, setAttorneyConsent] = useState(false);
  const savingDraftRef = useRef(false);
  const sendingRequestRef = useRef(false);
  const delivery = useRequestDelivery();
  const requestIdentity = useRequestIdentity();
  const requestGeneration = useRef(0);
  const previousRequestUser = useRef(delivery.user?.id);
  const scroll = useRef<ScrollView>(null);

  const form = forms.find(item => item.id === formId) || forms[0];
  const schema = checks.find(item => item.id === form.id);
  const qualification = evaluateQualification(schema, answers);
  const question = schema?.questions[questionIndex];
  const offer = aiOffer(form.id);
  const attorney = attorneys.forms.find((item: any) => item.id === form.id);
  const interview = interviews.forms.find((item: any) => item.id === form.id);
  const fields = (interview?.fields || []) as PreparationField[];
  const field = fields[fieldIndex];
  const draft = drafts[form.id] || {};
  const progress = draftProgress(fields, draft, completedFieldIds);
  const selectedStatus = finder.statuses.find((item: any) => item.id === statusId);
  const selectedGoal = selectedStatus?.goals.find((item: any) => item.id === goalId);
  const visibleForms = useMemo(() => forms.filter(item => {
    return (category === 'All' || item.category === category) && matchesFormSearch(item, search, `${formLabels[item.id]} ${t(formLabels[item.id])} ${t(item.title)} ${t(item.summary)} ${t(item.category)}`);
  }), [search, category, language]);

  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [route, formId, questionIndex, fieldIndex]);
  useEffect(() => {
    const active = route === 'fullPreparation' || route === 'freePreparation';
    onFullSessionActiveChange?.(active);
    return () => { if (active) onFullSessionActiveChange?.(false); };
  }, [route, onFullSessionActiveChange]);

  useEffect(() => {
    const userId = delivery.user?.id;
    if (previousRequestUser.current && previousRequestUser.current !== userId) {
      requestGeneration.current += 1;
      sendingRequestRef.current = false; setSendingRequest(false);
      setLawyer({ name: '', email: '', phone: '', note: '' }); setLawyerErrors({});
      setRequestReceipt(null); setRequestError(''); setAttorneyConsent(false); requestIdentity.reset();
      setRoute(current => current === 'attorneyPreview' ? 'attorney' : current);
    }
    previousRequestUser.current = userId;
  }, [delivery.user?.id]);
  useEffect(() => () => { requestGeneration.current += 1; onSaveErrorChange?.(false); }, [onSaveErrorChange]);

  useEffect(() => {
    if (!resumeRequest) return;
    let active = true;
    setLoadingDraft(true); setResumeError(''); setDraftMessage(''); setPicker(null);
    loadDraft(resumeFormId).then(async saved => {
      if (!active) return;
      if (!saved) throw new Error('This saved draft is no longer available. Choose a form to start again.');
      if ((saved.mode || 'ai') === 'ai') {
        saved = await preparePaymentDraft(saved);
        await saveDraft(saved, draftOwner);
        if (!active) return;
      }
      const restoredForm = forms.find(item => item.id === saved.formId);
      if (!restoredForm) throw new Error('This saved form is not in the current catalog. Your stored draft has not been changed.');
      const restoredSchema = checks.find(item => item.id === saved.formId);
      const restoredFields = (interviews.forms.find((item: any) => item.id === saved.formId)?.fields || []) as PreparationField[];
      const restored = draftResume(restoredSchema, saved.checks, restoredFields, saved.answers, saved.completedFieldIds);
      setFormId(saved.formId); setReturnTo('home'); setMode(saved.mode || 'ai');
      latestDraft.current = saved; setInitialDraft(saved); setPreparationVersion(value => value + 1); setCompletedFieldIds(saved.completedFieldIds || []);
      setDrafts(previous => ({ ...previous, [saved.formId]: { ...saved.answers } }));
      setAnswers({ ...saved.checks }); setQuestionIndex(restored.qualification.index);
      setFieldIndex(Math.max(0, restored.progress.firstUnanswered)); setFieldError('');
      setEditingDraft(false); setShowCheckAnswers(false); setDraftFinished(restored.progress.complete);
      setDraftMessage('Your draft is saved automatically on this device.');
      setLawyer(saved.attorneyDetails || { name: '', email: '', phone: '', note: '' });
      setRequestReceipt(null); setRequestError(''); setAttorneyConsent(false); requestIdentity.reset();
      if (restored.qualification.status === 'passed' && saved.mode === 'self') {
        setRoute('freePreparation');
      } else if (saved.mode === 'attorney') {
        setRoute('attorney');
      } else if (restored.qualification.status === 'passed' || (saved.stage === 'fullPreparation' && allowsReviewDraft(saved.formId,saved.mode || 'ai',restoredSchema,saved.checks))) {
        setRoute(saved.stage === 'interview' ? restored.progress.complete ? 'interviewReview' : 'interview' : 'fullPreparation');
      } else {
        setRoute(restored.qualification.status === 'checking' ? 'check' : 'result');
      }
    }).catch(error => {
      if (active) setResumeError(error instanceof Error ? error.message : 'Your saved draft could not be opened. Please try again.');
    }).finally(() => { if (active) setLoadingDraft(false); });
    return () => { active = false; };
  }, [resumeFormId, resumeRequest, resumeAttempt]);

  function openForm(id: string, origin: Route = route) {
    if (onOpenApplicationForm) { onOpenApplicationForm(id); return; }
    latestDraft.current = undefined; setInitialDraft(undefined); setCompletedFieldIds([]);
    setFormId(id); setReturnTo(origin === 'detail' ? 'catalog' : origin); setRoute('detail');
    setAnswers({}); setQuestionIndex(0); setShowCheckAnswers(false); setFieldError('');
    setDraftFinished(false); setDraftMessage(''); setDraftError(''); setEditingDraft(false);
    setRequestReceipt(null); setRequestError(''); setLawyerErrors({}); requestIdentity.reset();
    if (id !== formId) setLawyer(previous => ({ ...previous, note: '' }));
  }

  function editCheck(index: number) {
    const previous: Record<string, QualificationAnswer> = {};
    schema?.questions.slice(0, index).forEach(item => { if (answers[item.id]) previous[item.id] = answers[item.id]; });
    setAnswers(previous); setQuestionIndex(index); setRoute('check');
    void autosave(makeDraft('check', { checks: previous }));
  }

  function goBack() {
    if (savingDraftRef.current || sendingRequestRef.current || loadingDraft) return true;
    if (route === 'home') return false;
    if (route === 'catalog' || route === 'finder') {
      if (onExitToApplications) void returnToApplications();
      else setRoute('home');
    }
    else if (route === 'detail') {
      if (onExitToApplications) void returnToApplications();
      else setRoute(returnTo === 'home' || returnTo === 'finder' ? returnTo : 'catalog');
    }
    else if (route === 'check') { if (questionIndex > 0) editCheck(questionIndex - 1); else setRoute('detail'); }
    else if (route === 'result') editCheck(Math.min(qualification.index, (schema?.questions.length || 1) - 1));
    else if (route === 'aiIntro' || route === 'attorney') setRoute('result');
    else if (route === 'interview') { setFieldError(''); if (editingDraft) setRoute('interviewReview'); else if (fieldIndex > 0) setFieldIndex(fieldIndex - 1); else setRoute('aiIntro'); }
    else if (route === 'interviewReview') setRoute('aiIntro');
    else if (route === 'attorneyPreview') setRoute('attorney');
    return true;
  }

  useEffect(() => {
    if (!isActive || route === 'fullPreparation' || route === 'freePreparation') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => subscription.remove();
  }, [isActive, route, questionIndex, fieldIndex, editingDraft, returnTo, qualification.index, answers, loadingDraft, onExitToApplications]);

  function makeDraft(stage: NonNullable<SavedDraft['stage']>, overrides: Partial<SavedDraft> = {}): SavedDraft {
    const currentChecks = overrides.checks || answers;
    const currentAnswers = overrides.answers || draft;
    const currentMode = overrides.mode || mode;
    const currentProgress = draftProgress(fields, currentAnswers, overrides.completedFieldIds || completedFieldIds);
    const checkProgress = Object.keys(currentChecks).length;
    return {
      ...(latestDraft.current?.formId === form.id ? latestDraft.current : {}),
      version: 1, formId: form.id, title: form.title, mode: currentMode, stage,
      ...(currentMode === 'ai' ? { paymentCaseId: latestDraft.current?.paymentCaseId || randomUUID() } : {}),
      answers: { ...currentAnswers }, checks: { ...currentChecks }, completedFieldIds,
      answered: stage === 'check' ? checkProgress : currentProgress.answered,
      total: stage === 'check' ? Math.max(1, schema?.questions.length || 0) : Math.max(1, fields.length),
      ...(currentMode === 'attorney' ? { attorneyStatus: latestDraft.current?.attorneyStatus || 'awaiting_call', attorneyDetails: { ...lawyer } } : {}),
      ...overrides, updatedAt: new Date().toISOString(),
    };
  }

  async function preparePaymentDraft(saved: SavedDraft): Promise<SavedDraft> {
    // Preserve an explicit binding; otherwise the server selects a paid package
    // from its verified ledger, even when related local drafts are missing.
    return { ...saved, paymentCaseId: saved.paymentCaseId || randomUUID() };
  }

  function autosave(saved: SavedDraft): Promise<boolean> {
    latestDraft.current = saved;
    const generation = ++saveGeneration.current;
    const operation = (async () => {
      try {
        await saveDraft(saved, draftOwner);
        onDraftSaved?.(saved);
        if (generation === saveGeneration.current) { onSaveErrorChange?.(false); setDraftError(''); setDraftMessage('Saved automatically on this device.'); }
        return true;
      } catch (error) {
        if (generation === saveGeneration.current) {
          onSaveErrorChange?.(true);
          setDraftMessage('');
          setDraftError(error instanceof Error ? error.message : 'Your draft could not be saved. Please try again.');
        }
        return false;
      }
    })();
    latestSave.current = operation;
    return operation;
  }

  async function returnToApplications() {
    if (!onExitToApplications || returningToApplications.current || loadingDraft || sendingRequestRef.current) return;
    returningToApplications.current = true;
    try {
      let operation: Promise<boolean>;
      let saved: boolean;
      do { operation = latestSave.current; saved = await operation; } while (operation !== latestSave.current);
      if (saved) onExitToApplications();
      else scroll.current?.scrollTo({ y: 0, animated: true });
    } finally {
      returningToApplications.current = false;
    }
  }

  useEffect(() => {
    if (applicationReturnRequest === handledApplicationReturn.current || loadingDraft || sendingRequest) return;
    handledApplicationReturn.current = applicationReturnRequest;
    // PDF and guided editors flush their own saves before completing this request.
    if (route !== 'freePreparation' && route !== 'fullPreparation') void returnToApplications();
  }, [applicationReturnRequest, loadingDraft, sendingRequest, route]);

  async function startCheck(selectedMode: PreparationMode) {
    let existing: SavedDraft | null = null;
    if (selectedMode === 'ai') {
      if (loadingDraft) return;
      setLoadingDraft(true);
      try { existing = await loadDraft(form.id); }
      catch (error) { setDraftError(error instanceof Error ? error.message : 'Your saved draft could not be opened. Please try again.'); return; }
      finally { setLoadingDraft(false); }
    }
    setMode(selectedMode); setAnswers({}); setQuestionIndex(0); setShowCheckAnswers(false);
    const sameApplication = selectedMode === 'ai' && existing?.mode === 'ai' ? existing : undefined;
    setInitialDraft(sameApplication); setCompletedFieldIds([]); latestDraft.current = sameApplication;
    setDrafts(previous => ({ ...previous, [form.id]: {} }));
    setLawyer({ name: '', email: '', phone: '', note: '' });
    setRequestReceipt(null); setRequestError(''); setAttorneyConsent(false); requestIdentity.reset();
    void autosave(makeDraft(selectedMode === 'attorney' ? 'attorney' : 'check', { mode: selectedMode, checks: {}, answers: {}, completedFieldIds: [],
      ...(selectedMode === 'attorney' ? { attorneyDetails: { name: '', email: '', phone: '', note: '' } } : {}) }));
    const initial = evaluateQualification(schema, {});
    setRoute(selectedMode === 'attorney' ? 'attorney' : selectedMode === 'self' && initial.status === 'passed' ? 'freePreparation' : initial.status === 'checking' ? 'check' : 'result');
  }

  function answerCheck(answer: QualificationAnswer) {
    if (!question) return;
    const updated = { ...answers, [question.id]: answer };
    setAnswers(updated);
    void autosave(makeDraft('check', { checks: updated }));
    const next = evaluateQualification(schema, updated);
    if (next.status === 'checking') setQuestionIndex(next.index);
    else setRoute(mode === 'self' && next.status === 'passed' ? 'freePreparation' : 'result');
  }

  async function continueFromCheck() {
    if (qualification.status !== 'passed' && !allowsReviewDraft(form.id,mode,schema,answers)) return;
    if (mode === 'self') { setInitialDraft(latestDraft.current); setRoute('freePreparation'); return; }
    if (mode === 'attorney') { setLawyerErrors({}); void autosave(makeDraft('attorney')); setRoute('attorney'); return; }
    if (loadingDraft) return;
    setLoadingDraft(true);
    try {
      const saved = await preparePaymentDraft(latestDraft.current || makeDraft('check'));
      if (!await autosave(saved)) return;
      setInitialDraft(saved);
      setRoute('fullPreparation');
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : 'Save this application before continuing to payment.');
    } finally { setLoadingDraft(false); }
  }

  function saveField() {
    if (!field) return;
    const error = validateField(field, draft[field.id] || '');
    if (error) { setFieldError(error); return; }
    setFieldError('');
    const completed = Array.from(new Set([...completedFieldIds, field.id]));
    setCompletedFieldIds(completed);
    void autosave(makeDraft('interview', { completedFieldIds: completed }));
    if (editingDraft || fieldIndex === fields.length - 1) { setEditingDraft(false); setRoute('interviewReview'); }
    else setFieldIndex(fieldIndex + 1);
  }

  async function persistDraft(finish = false) {
    if (savingDraftRef.current) return false;
    if (qualification.status !== 'passed') { setDraftError('Complete the form check before saving this preparation draft.'); return false; }
    if (finish && progress.firstInvalid >= 0) {
      const invalid = fields[progress.firstInvalid];
      setFieldIndex(progress.firstInvalid); setFieldError(validateField(invalid, draft[invalid.id] || '') || 'Please complete this answer.');
      setEditingDraft(true); setRoute('interview'); return false;
    }
    const saved = makeDraft('interview');
    savingDraftRef.current = true; setSavingDraft(true); setDraftError(''); setDraftMessage('');
    try {
      if (!await autosave(saved)) return false;
      setDraftFinished(finish);
      setDraftMessage('Saved on this device. Resume this draft from My Application.');
      return true;
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : 'Your draft could not be saved. Keep this screen open and try again.');
      return false;
    } finally {
      savingDraftRef.current = false; setSavingDraft(false);
    }
  }

  function previewAttorney() {
    const errors: Record<string, string> = {};
    const phone = lawyer.phone.trim();
    const phoneDigits = phone.replace(/\D/g, '').length;
    if (!lawyer.name.trim()) errors.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lawyer.email.trim())) errors.email = 'Enter a valid email address.';
    if (phone && (phoneDigits < 7 || phoneDigits > 15 || !/^\+?[\d\s().-]+$/.test(phone))) errors.phone = 'Enter a phone number with 7–15 digits, or leave this blank.';
    if (!lawyer.note.trim()) errors.note = 'Briefly describe the help you need.';
    setLawyerErrors(errors);
    if (!Object.keys(errors).length) { setRequestReceipt(null); setRequestError(''); setAttorneyConsent(false); setRoute('attorneyPreview'); }
  }

  async function sendAttorneyRequest() {
    if (sendingRequestRef.current || requestReceipt || !delivery.canSubmit || !attorneyConsent) return;
    const generation = requestGeneration.current;
    sendingRequestRef.current = true; setSendingRequest(true); setRequestError('');
    try {
      const payload = {
        type: 'attorney' as const, name: lawyer.name.trim(), email: lawyer.email.trim(), phone: lawyer.phone.trim() || undefined,
        question: lawyer.note.trim(), formId: form.id, attorneyConsent: 'share-contact-and-question-v1' as const,
      };
      const receipt = await submitRequest(payload, requestIdentity.getId(payload, delivery.user?.id));
      if (generation !== requestGeneration.current) return;
      setRequestReceipt(receipt);
    } catch (error) {
      if (generation === requestGeneration.current) setRequestError(error instanceof Error ? error.message : 'The request could not be saved. Please try again.');
    } finally {
      if (generation === requestGeneration.current) { sendingRequestRef.current = false; setSendingRequest(false); }
    }
  }

  function formPriceSummary(item: FormRecord) {
    const ai = aiOffer(item.id);
    const reference = pricing.forms.find((entry: any) => entry.id === item.id).citizenPath;
    const lawyerPrice = attorneys.forms.find((entry: any) => entry.id === item.id)?.servicePriceUsd;
    const detail = reference.status === 'included' || reference.status === 'add-on' ? ai.note : item.id === 'I-485' ? 'Base package' : item.id === 'I-821D' ? 'Includes I-765 and I-765WS' : '';
    return <View style={styles.priceColumns}>
      <View style={styles.priceColumn}><Text style={styles.priceLabel}>{t("Do it yourself")}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.listPrice, language === 'ru' && { fontSize: contentWidth < 330 ? 12 : 15 }]}>{t("Free")}</Text></View>
      <View style={styles.priceColumn}><Text style={styles.priceLabel}>{t("With FillOut")}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.listPrice}>{t(ai.unavailable ? 'Ask in Chat' : ai.price)}</Text>{!!detail && <Text style={styles.priceNote}>{t(detail)}</Text>}{!ai.unavailable && <Pressable accessibilityRole="button" accessibilityLabel={t(`Read service terms for ${item.id}`)} onPress={() => setGuaranteeOpen(true)} hitSlop={6} style={styles.priceGuarantee}><Text style={styles.priceGuaranteeText}>{t("Service terms")}</Text></Pressable>}</View>
    </View>;
  }

  function pricedFormRow(item: FormRecord, shortTitle: boolean) {
    return <View key={item.id} style={styles.pricedFormRow}>
      <View style={styles.formInfo}><View style={styles.formCodeBadge}><Text style={styles.formCode}>{item.id}</Text></View><View style={{ flex: 1, gap: 4 }}><Text accessibilityRole="header" style={styles.rowTitle}>{t(shortTitle ? formLabels[item.id] || item.title : item.title)}</Text><Text style={styles.formSummary}>{t(item.summary)}</Text></View></View>
      {formPriceSummary(item)}
      <Button title={t("Start filling out form")} accessibilityLabel={t(`Start filling out form ${item.id}`)} icon="arrow-forward" onPress={() => openForm(item.id)} />
    </View>;
  }

  function formRow(item: FormRecord) {
    return pricedFormRow(item, false);
  }

  function homeForms() {
    const mainForms = mainFormIds.map(id => forms.find(item => item.id === id)).filter((item): item is FormRecord => !!item);
    const otherForms = forms.filter(item => !mainFormIds.includes(item.id));
    return <View style={{ gap: 12 }}>
      <SectionTitle eyebrow={t("YOUR FORM. YOUR WAY.")} title={t("Immigration forms")} subtitle={t("Choose free self-preparation, FillOut guidance or a free attorney contact request.")} />
      <Button title={t("Search by form number or name")} variant="secondary" icon="search-outline" onPress={() => setRoute('catalog')} />
      <Text accessibilityRole="header" style={styles.label}>{t("Main forms")}</Text>
      {mainForms.map(item => pricedFormRow(item, true))}
      <Pressable accessibilityRole="button" accessibilityLabel={t(`All other forms, ${otherForms.length} documents`)} accessibilityState={{ expanded: otherFormsOpen }} onPress={() => setOtherFormsOpen(!otherFormsOpen)} style={styles.otherFormsHeader}>
        <View style={{ flex: 1, gap: 3 }}><Text style={styles.label}>{t("All other forms")}</Text><Text style={styles.small}>{t("Compare all three preparation options")}</Text></View><Badge>{otherForms.length}</Badge><Ionicons name={otherFormsOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.navy} />
      </Pressable>
      {otherFormsOpen && otherForms.map(item => pricedFormRow(item, true))}
      <Text style={styles.footnote}>{t("The App Store shows the final price before payment. Government filing fees are separate.")}</Text>
    </View>;
  }

  function selector(kind: 'status' | 'goal', label: string, value: string | undefined, placeholder: string) {
    const disabled = kind === 'goal' && !selectedStatus;
    return <View style={styles.selectorField}><Text style={styles.selectorLabel}>{t(label)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t(label)}. ${t(value || placeholder)}`} accessibilityState={{ disabled, expanded: picker === kind }} disabled={disabled} onPress={() => setPicker(kind)} style={[styles.selector, disabled && { opacity: 0.6 }]}>
        <Text style={[styles.selectorValue, !value && { color: colors.muted }]}>{t(value || placeholder)}</Text><Ionicons name="chevron-down" size={17} color={colors.navy} />
      </Pressable>
    </View>;
  }

  function showFormMatches() {
    if (!selectedStatus) { setPicker('status'); return; }
    if (!selectedGoal) { setPicker('goal'); return; }
    setFinderMatchesVisible(true);
    AccessibilityInfo.announceForAccessibility(t('{count} matching forms found below.', { count: selectedGoal.forms.length }));
  }

  function finderCard() {
    return <Card style={styles.finderCard}>
      <View style={styles.sectionHeading}><View style={styles.finderIcon}><Ionicons name="search-outline" color={colors.navy} size={27} /></View><View style={{ flex: 1, gap: 5 }}><Text accessibilityRole="header" style={styles.cardTitle}>{t("Find the right USCIS form")}</Text><Text style={styles.small}>{t("Tell us about your situation to get started.")}</Text></View></View>
      <View style={styles.finderFields}>
        {selector('status', 'I am', selectedStatus?.label, 'Choose your status')}
        {selector('goal', 'I would like to', selectedGoal?.label, 'Choose what to do')}
      </View>
      <Button title={t("Find My Form")} icon="arrow-forward" onPress={showFormMatches} />
      {finderMatchesVisible && !!selectedGoal && <View style={{ gap: 12 }} accessibilityLiveRegion="polite"><Text style={styles.eyebrow}>{t("YOUR MATCH")}</Text>{selectedGoal.forms.map((id: string) => forms.find(item => item.id === id)).filter(Boolean).map(formRow)}<Text style={styles.small}>{t("A form match is a starting point. A short check follows before preparation.")}</Text></View>}
      {!!statusId && <Button title={t("Reset choices")} variant="quiet" onPress={() => { setStatusId(''); setGoalId(''); setFinderMatchesVisible(false); }} />}
    </Card>;
  }

  function confidencePoints() {
    const points: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
      { icon: 'shield-checkmark-outline', label: 'Official\nforms' },
      { icon: 'time-outline', label: 'Save\ntime' },
      { icon: 'people-outline', label: 'Clear\nguidance' },
    ];
    return <View style={styles.confidencePoints}>{points.map((point, index) => <View key={point.label} style={[styles.confidencePoint, index > 0 && styles.confidencePointBorder]}><Ionicons name={point.icon} size={25} color="#F0F5FF" /><Text style={styles.confidencePointText}>{t(point.label)}</Text></View>)}</View>;
  }

  function confidenceSection() {
    return <View style={{ gap: 14 }}>
      <ImageBackground source={require('../../assets/fillout-hero-bg.jpg')} resizeMode="cover" style={styles.confidenceBanner} imageStyle={styles.backgroundImage}>
        <View style={styles.confidenceBannerContent}>
        <View style={styles.confidenceBannerTop}>
          <Ionicons name="documents-outline" size={Math.min(90, (contentWidth - 40) * 0.25)} color="#F3D783" accessibilityLabel={t("Official USCIS forms")} />
          <View style={{ flex: 1, gap: 8 }}><Text accessibilityRole="header" style={styles.confidenceTitle}>{t("File your immigration forms with ")}<Text style={{ color: colors.gold }}>{t("confidence.")}</Text></Text><Text style={styles.confidenceCopy}>{t("Official forms. Clear steps. A simpler way forward.")}</Text></View>
        </View>
        {confidencePoints()}
        <Pressable accessibilityRole="button" onPress={() => setGuaranteeOpen(true)} style={styles.guaranteeLink}><Text style={styles.guaranteeLinkText}>{t("Preparation service · Read terms")}</Text><Ionicons name="arrow-forward" size={15} color="#F3D783" /></Pressable>
        </View>
      </ImageBackground>
      <Card style={styles.whyCard}>
        <View style={{ gap: 10 }}><Text accessibilityRole="header" style={styles.whyTitle}>{t("Why it matters")}</Text><View style={styles.goldLine} /><Text style={styles.body}>{t("Small details deserve a careful check. Start with the right form, read the current instructions and review your answers before filing.")}</Text></View>
        <View style={styles.reasonCards}>
          <View style={[styles.reasonCard, { backgroundColor: '#FFF2F3' }]}><Ionicons name="document-text-outline" size={35} color="#B24C5C" /><Text style={styles.reasonTitle}>{t("Complete details")}</Text><Text style={styles.reasonCopy}>{t("Check required answers and signatures.")}</Text></View>
          <View style={[styles.reasonCard, { backgroundColor: '#FFF8E9' }]}><Ionicons name="documents-outline" size={35} color="#A47B31" /><Text style={styles.reasonTitle}>{t("Current forms")}</Text><Text style={styles.reasonCopy}>{t("Check the edition and filing instructions.")}</Text></View>
        </View>
        <Button title={t("File the Right Form")} icon="arrow-forward" onPress={() => setRoute('finder')} />
      </Card>
    </View>;
  }

  function home() {
    const benefits: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
      { icon: 'search-outline', title: 'Find your starting point', text: 'Match your situation with a form and work through a short preliminary check.' },
      { icon: 'document-text-outline', title: 'Official USCIS forms', text: 'Open the official document and current USCIS instructions for your form.' },
      { icon: 'list-outline', title: 'One question at a time', text: 'Answer the official form questions and send your completed form to FillOut for review. Download and print are available after our approval.' },
      { icon: 'save-outline', title: 'Pick up where you left off', text: 'Save a draft on this device and return to it in My Application.' },
      { icon: 'create-outline', title: 'Free self-preparation', text: 'Use official USCIS documents at no FILLOUT preparation charge. Government fees may apply.' },
      { icon: 'chatbubbles-outline', title: 'Chat with our team', text: 'Review a question and your contact details before sending a support request.' },
    ];
    return <>
      <View style={styles.topLine}><BrandMark width={Math.min(contentWidth - 56, 370) / 2} /><LanguageSwitcher /></View>
      <ImageBackground source={require('../../assets/fillout-hero-bg.jpg')} resizeMode="cover" style={styles.hero} imageStyle={styles.backgroundImage}>
        <View style={styles.heroContent}>
        <Text style={styles.heroEyebrow}>{t("IMMIGRATION MADE SIMPLE")}</Text>
        <Text accessibilityRole="header" style={[styles.heroTitle, { fontSize: contentWidth < 315 ? 27 : contentWidth > 470 ? 43 : 29, lineHeight: contentWidth < 315 ? 34 : contentWidth > 470 ? 51 : 36 }]}>{t("Prepare immigration paperwork, ")}<Text style={{ color: colors.gold }}>{t("step by step.")}</Text></Text>
        <Text style={styles.heroCopy}>{t("Find your form. Follow clear steps.")}{'\n'}{t("Move forward with confidence.")}</Text>
        {confidencePoints()}
        <Pressable accessibilityRole="button" accessibilityLabel={t("Read service terms")} onPress={() => setGuaranteeOpen(true)} hitSlop={10}><Text style={styles.heroTerms}>{t("Review service terms")}</Text></Pressable>
        </View>
      </ImageBackground>
      {finderCard()}
      {confidenceSection()}
      {homeForms()}
      <SectionTitle eyebrow={t("SUPPORT AT EVERY STEP")} title={t("A clearer path to your paperwork")} />
      <Card style={{ gap: 16, padding: 16 }}>{benefits.map(item => <View key={item.title} style={{ flexDirection: 'row', gap: 10 }}><View style={styles.benefitIcon}><Ionicons name={item.icon} size={21} color={colors.navy} /></View><View style={{ flex: 1, gap: 3 }}><Text style={styles.label}>{t(item.title)}</Text><Text style={styles.small}>{t(item.text)}</Text></View></View>)}</Card>
      <View style={styles.homeFooter}><Text style={styles.footerText}>{t("FILLOUT is not affiliated with USCIS. A form check does not determine legal eligibility or guarantee approval.")}</Text><Text style={styles.footerText}>{t("Government fees are separate. FillOut does not file or mail applications to USCIS.")}</Text><Button title={t("Privacy Policy")} variant="quiet" onPress={() => void openOfficial('https://fillout.net/privacy/', t)} /><Button title={t("Support")} variant="quiet" onPress={() => void openOfficial('https://fillout.net/support/', t)} /></View>
    </>;
  }

  function catalog() {
    return <><SectionTitle eyebrow={t("YOUR DOCUMENTS, ONE PLACE")} title={t("Find your next step")} subtitle={t("Explore all 21 forms and supporting documents.")} />
      <Field label={t("Search forms")} placeholder={t("Try N-400, citizenship or work permit")} value={search} onChangeText={setSearch} autoCorrect={false} clearButtonMode="while-editing" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>{categories.map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: item === category }} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipSelected]}><Text style={[styles.chipText, category === item && { color: colors.paper }]}>{t(item)}</Text></Pressable>)}</ScrollView>
      <Button title={t("Help me choose a form")} variant="secondary" icon="search-outline" onPress={() => setRoute('finder')} />
      <Text accessibilityLiveRegion="polite" style={styles.small}>{visibleForms.length} {t(visibleForms.length === 1 ? 'document' : 'documents')}</Text>
      {visibleForms.length ? <View style={{ gap: 16 }}>{visibleForms.map(formRow)}</View> : <Notice title={t("No forms found")}>{t("Try a form number or a broader search, such as family or travel.")}</Notice>}
      {(!!search || category !== 'All') && <Button title={t("Clear search and filters")} variant="quiet" onPress={() => { setSearch(''); setCategory('All'); }} />}
      <Text style={styles.footnote}>{t("Government filing fees are separate from preparation services.")}</Text>
    </>;
  }

  function details() {
    if (form.id === 'G-639') return <><Badge>G-639 · FOIA</Badge><SectionTitle title={t(form.title)} subtitle={t(form.summary)} /><Notice>{t('USCIS generally requires FOIA and Privacy Act requests online. Use the USCIS online records service and check its current exceptions before submitting a paper request.')}</Notice><Button title={t('Open USCIS online records request')} icon="open-outline" onPress={() => void openOfficial('https://www.uscis.gov/records/request-records-through-the-freedom-of-information-act-or-privacy-act', t)} /><Button title={t('Request attorney contact')} variant="secondary" onPress={() => void startCheck('attorney')} /></>;
    return <><Badge gold>{form.id} · {t(form.category)}</Badge><SectionTitle title={t(form.title)} subtitle={t(form.summary)} />
      <Text style={styles.body}>{t("Choose how to prepare, or leave a free request for an attorney to contact you.")}</Text>
      <Card><View style={styles.sectionHeading}><Ionicons name="create-outline" size={25} color={colors.navy} /><Text style={styles.cardTitle}>{t("Do it yourself")}</Text></View><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.price, language === 'ru' && { fontSize: 26 }]}>{t("Free")}</Text><Text style={styles.small}>{t("No preparation charge")}</Text><Text style={styles.body}>{t("After the short check, fill in your PDF form, save your answers and print your completed document.")}</Text><Button title={t("Start free form check")} variant="secondary" onPress={() => startCheck('self')} /></Card>
      <Card style={{ borderColor: colors.gold, borderWidth: 1.5 }}><View style={styles.sectionHeading}><Ionicons name="sparkles-outline" size={25} color={colors.navy} /><Text style={styles.cardTitle}>{t("Prepare with FillOut")}</Text></View><Text style={styles.price}>{t(offer.price)}</Text><Text style={styles.small}>{t(offer.note)}</Text><Text style={styles.body}>{t('Answer the official form questions and send your completed form to FillOut for review. Download and print are available after our approval.')}</Text><Button title={t("Check & prepare with FillOut")} variant="gold" onPress={() => startCheck('ai')} /><Text style={styles.footnote}>{t('Payment availability depends on the selected form and store. Follow the official instructions for the sections that apply to you.')}</Text></Card>
      <Card><View style={styles.sectionHeading}><Ionicons name="briefcase-outline" size={25} color={colors.navy} /><Text style={styles.cardTitle}>{t("Request attorney contact")}</Text></View><Text style={styles.price}>{t("Free request")}</Text><Text style={styles.body}>{t("With your permission, FillOut passes your contact details and question to an independent attorney. The attorney contacts you directly. Any legal services and fees are agreed with the attorney outside FillOut.")}</Text><Button title={t("Request attorney contact")} variant="secondary" onPress={() => startCheck('attorney')} /></Card>
      <Text style={styles.footnote}>{t("AI payment follows a passed form check, before the guided questions. Free self-preparation has no service charge. Government fees are separate.")}</Text>
      <Button title={t("View official USCIS information")} variant="quiet" icon="open-outline" onPress={() => void openOfficial(form.officialUrl, t)} />
    </>;
  }

  function checkScreen() {
    if (!question || !schema) return <Notice title={t("Review needed")}>{t("Please contact our team to review this form.")}</Notice>;
    return <><Badge>{form.id} · {t(modeNames[mode])}</Badge><SectionTitle title={t("Let’s check your starting point")} subtitle={t("A few questions help us find the right preparation path.")} />
      <View style={{ gap: 9 }}><Text style={styles.small}>{t('Question {current} of {total}', { current: questionIndex + 1, total: schema.questions.length })}</Text><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${(questionIndex + 1) / schema.questions.length * 100}%` }]} /></View></View>
      <Card><Text accessibilityRole="header" style={styles.question}>{t(question.text)}</Text>{!!question.help && <Text style={styles.body}>{t(question.help)}</Text>}<View style={{ gap: 10 }}><Button title={t("Yes")} variant={question.yes === 'next' ? 'primary' : 'secondary'} onPress={() => answerCheck('yes')} /><Button title={t("No")} variant={question.no === 'next' ? 'primary' : 'secondary'} onPress={() => answerCheck('no')} /><Button title={t("I’m not sure — request review")} variant="quiet" onPress={() => answerCheck('unsure')} /></View></Card>
      <Notice>{t("This is a preliminary form check. It does not decide your legal eligibility or guarantee USCIS approval.")}</Notice>
      <Button title={t("Read the USCIS requirements")} variant="quiet" icon="open-outline" onPress={() => void openOfficial(schema.sourceUrl, t)} />
    </>;
  }

  function checkResult() {
    const passed = qualification.status === 'passed';
    const stopped = qualification.status === 'stopped';
    const title = passed ? 'Congratulations!' : stopped ? 'Sorry, this form isn’t a match' : 'Your situation needs a closer look';
    const reason = passed ? 'Your answers fit this preliminary preparation path. The full USCIS requirements and your documents still need to be checked.' : qualification.reason;
    const primary = mode === 'self' ? 'Open PDF form' : mode === 'attorney' ? 'Continue to attorney intake' : getAiPaymentKind(form.id) === 'free' ? 'Continue to guided preparation' : 'Continue to payment';
    return <><Badge>{form.id} · {t(modeNames[mode])}</Badge><View style={[styles.resultIcon, { backgroundColor: passed ? colors.successLight : colors.goldLight }]}><Ionicons name={passed ? 'checkmark-circle-outline' : stopped ? 'compass-outline' : 'chatbubbles-outline'} size={45} color={passed ? colors.success : colors.navy} /></View><SectionTitle title={t(title)} subtitle={t(reason)} />
      {passed ? <><Button title={t(primary)} variant={mode === 'ai' ? 'gold' : 'primary'} icon={mode === 'self' ? 'document-text-outline' : 'arrow-forward'} onPress={continueFromCheck} />{mode === 'self' && <Text style={styles.small}>{t("Fill in the PDF form, save your filled copy and print it for signing. Review the current USCIS instructions before filing.")}</Text>}</> : <><Notice tone="warning">{t("This result is not a decision that you are ineligible for an immigration benefit. Exceptions or another process may apply.")}</Notice>{allowsReviewDraft(form.id,mode,schema,answers) && <><Notice>{t('This form still needs individual review. You can fill out a draft, but this check has not confirmed a filing path. Review the current official guidance before filing.')}</Notice><Button title={t('Prepare a draft for review')} variant="gold" onPress={continueFromCheck} /></>}<Button title={t("Chat with our team")} onPress={onContact} /><Button title={t("Explore other forms")} variant="secondary" onPress={() => { if (onExitToApplications) void returnToApplications(); else setRoute('catalog'); }} /></>}
      <Card><RowLink title={t(showCheckAnswers ? 'Hide your answers' : 'Review or change your answers')} onPress={() => setShowCheckAnswers(!showCheckAnswers)} icon={showCheckAnswers ? 'chevron-up' : 'chevron-down'} />{showCheckAnswers && schema?.questions.map((item, index) => answers[item.id] ? <RowLink key={item.id} title={t(item.text)} subtitle={t(answers[item.id] === 'unsure' ? 'Not sure · Tap to change' : `${answers[item.id] === 'yes' ? 'Yes' : 'No'} · Tap to change`)} onPress={() => editCheck(index)} icon="create-outline" /> : null)}</Card>
      <Button title={t("Back to preparation options")} variant="quiet" onPress={() => setRoute('detail')} />
    </>;
  }

  function aiIntro() {
    return <><Badge gold>{form.id} {t("· GUIDED PREPARATION")}</Badge><SectionTitle title={t("One question at a time")} subtitle={t("Build a clear draft of your information before completing your application.")} />
      <Card><View style={styles.sectionHeading}><BrandMark compact /><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{t("FILLOUT preparation")}</Text><Text style={styles.small}>{t(interview?.subject)}</Text></View></View>
        <View style={styles.metaRow}><Text style={styles.body}>{fields.length} {t("starting questions")}</Text><Text style={styles.label}>{t(offer.price)}</Text></View>
        <Text style={styles.small}>{t(progress.answered ? `${progress.answered} of ${fields.length} answers completed.` : 'You can review and edit every answer.')}</Text>
        <Button title={t(Object.keys(draft).length ? 'Continue my draft' : 'Start the questions')} variant="gold" icon="arrow-forward" onPress={() => {
          setFieldIndex(Math.max(0, progress.firstUnanswered)); setEditingDraft(false); setFieldError('');
          setRoute(progress.complete ? 'interviewReview' : 'interview');
        }} />
      </Card>
      <Notice title={t("About your draft")}>{t("Your draft is saved on this device. Sending a document to our team requires your confirmation. FillOut does not submit applications to USCIS.")}</Notice>
    </>;
  }

  function interviewScreen() {
    if (!field) return <Notice title={t("Draft unavailable")}>{t("Chat with our team for help with this document.")}</Notice>;
    const inputType = field.type;
    return <><Badge gold>{form.id} {t("· PREPARATION DRAFT")}</Badge><View style={styles.metaRow}><Text style={styles.small}>{t(editingDraft ? 'Edit your answer' : `Question ${fieldIndex + 1} of ${fields.length}`)}</Text><Text style={styles.small}>{t("Saved automatically on this device")}</Text></View><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${(fieldIndex + 1) / fields.length * 100}%` }]} /></View><SectionTitle title={t(field.label)} />
      <Field label={t(inputType === 'date' ? 'Date · MM/DD/YYYY' : 'Your answer')} help={t(field.help)} value={draft[field.id] || ''} editable={!savingDraft} onChangeText={value => { const updated = { ...draft, [field.id]: value }; setDrafts(previous => ({ ...previous, [form.id]: updated })); void autosave(makeDraft('interview', { answers: updated })); if (fieldError) setFieldError(''); setDraftFinished(false); }}
        placeholder={t(inputType === 'date' ? 'MM/DD/YYYY' : inputType === 'email' ? 'name@example.com' : inputType === 'tel' ? '+1 (555) 000-0000' : 'Enter your answer')}
        multiline={inputType === 'textarea'} autoCapitalize={inputType === 'email' ? 'none' : 'sentences'} keyboardType={inputType === 'email' ? 'email-address' : inputType === 'tel' ? 'phone-pad' : inputType === 'date' ? 'numbers-and-punctuation' : 'default'}
        maxLength={inputType === 'textarea' ? 2000 : inputType === 'date' ? 10 : 300} error={t(fieldError)} />
      <Button title={t(editingDraft ? 'Update answer' : fieldIndex === fields.length - 1 ? 'Review my answers' : 'Next question')} disabled={savingDraft} variant="gold" icon="arrow-forward" onPress={saveField} />
      <Button title={t(savingDraft ? 'Saving…' : 'Save for later')} disabled={savingDraft} variant="secondary" icon="bookmark-outline" onPress={() => void persistDraft()} />
      <Text style={styles.footnote}>{t("Enter accurate information. If a question does not fit your situation, contact our team for help.")}</Text>
    </>;
  }

  function interviewReview() {
    return <><Badge gold>{form.id} {t("· PREPARATION DRAFT")}</Badge><SectionTitle title={t(draftFinished ? 'Your draft is ready to revisit' : 'Review your answers')} subtitle={t("Tap an answer to make a correction.")} />
      {draftFinished && <Notice tone="success" title={t("Draft saved on this device")}>{t("You can reopen your answers from My Application. No application has been generated or filed.")}</Notice>}
      <Card style={{ paddingVertical: 3 }}>{fields.map((item, index) => <RowLink key={item.id} title={t(item.label)} subtitle={draft[item.id] || t('Not answered')} onPress={() => { if (savingDraft) return; setFieldIndex(index); setEditingDraft(true); setFieldError(''); setDraftMessage(''); setRoute('interview'); }} icon="create-outline" />)}</Card>
      {!draftFinished && <><Button title={t(savingDraft ? 'Saving…' : 'Save reviewed draft')} disabled={savingDraft} variant="gold" onPress={() => void persistDraft(true)} /><Button title={t("Save for later")} disabled={savingDraft} variant="secondary" onPress={() => void persistDraft()} /></>}
      <Button title={t('Continue to full questionnaire')} disabled={savingDraft} variant="gold" onPress={() => { void persistDraft().then(saved => { if (saved) { setInitialDraft(latestDraft.current); setRoute('fullPreparation'); } }); }} />
      <Button title={t("Ask in Chat about next steps")} disabled={savingDraft} variant="secondary" onPress={onContact} />
      <Button title={t("Back to this form")} disabled={savingDraft} variant="quiet" onPress={() => setRoute('detail')} />
      <Text style={styles.footnote}>{t("A preparation draft is not a completed USCIS form. Only saved answers remain after closing the app; deleting app or browser data removes local drafts.")}</Text>
    </>;
  }

  function attorneyIntake() {
    const updateLawyer = (key: keyof typeof lawyer, value: string) => {
      requestIdentity.reset();
      const updated = { ...lawyer, [key]: value };
      setLawyer(updated);
      void autosave(makeDraft('attorney', { attorneyDetails: updated }));
    };
    return <><Badge>{form.id} {t("· ATTORNEY CONTACT REQUEST")}</Badge><SectionTitle title={t("Request attorney contact")} subtitle={t("Leave your contact details and a short question. Sending this request is free.")} /><Notice>{t("With your permission, FillOut passes your contact details and question to an independent attorney. The attorney contacts you directly. Any legal services and fees are agreed with the attorney outside FillOut.")}</Notice>
      <Field label={t("Your full name")} value={lawyer.name} onChangeText={name => updateLawyer('name', name)} autoComplete="name" maxLength={150} error={t(lawyerErrors.name)} />
      <Field label={t("Email address")} value={lawyer.email} onChangeText={email => updateLawyer('email', email)} autoComplete="email" autoCapitalize="none" keyboardType="email-address" maxLength={254} error={t(lawyerErrors.email)} />
      <Field label={t("Phone number · optional")} value={lawyer.phone} onChangeText={phone => updateLawyer('phone', phone)} autoComplete="tel" keyboardType="phone-pad" maxLength={40} error={t(lawyerErrors.phone)} />
      <Field label={t("What would you like help with?")} help={t("A brief description is enough. Avoid identity numbers or sensitive document details.")} value={lawyer.note} onChangeText={note => updateLawyer('note', note)} multiline maxLength={2000} error={t(lawyerErrors.note)} />
      <Button title={t("Preview my request")} icon="arrow-forward" onPress={previewAttorney} /><Notice>{t("This preview does not send your request, book an attorney, charge a fee or establish an attorney-client relationship.")}</Notice>
    </>;
  }

  function attorneyPreview() {
    return <><Badge>{form.id} · {t(requestReceipt ? 'REQUEST SAVED' : 'REQUEST PREVIEW')}</Badge>
      <SectionTitle title={t(requestReceipt ? requestReceipt.delivery === 'team-inbox' ? 'Your request has been received' : 'Your request is saved locally' : 'Your request is ready to review')} subtitle={t(requestReceipt ? requestReceipt.delivery === 'team-inbox' ? 'Your details are saved in the FILLOUT team inbox.' : 'Your request is in the local inbox on this computer.' : 'Review your details before sending your request.')} />
      {!!requestReceipt && <Notice tone="success" title={t(requestReceipt.delivery === 'team-inbox' ? 'Request receipt' : 'Local receipt')}><Text selectable style={styles.small}>{t("Reference: ")}{requestReceipt.id}</Text><Text style={styles.small}>{t("Your request is saved for the FillOut team to pass to an independent attorney. No payment was collected. Sending a request does not book an attorney or establish an attorney-client relationship.")}</Text></Notice>}
      <Card><Text style={styles.cardTitle}>{lawyer.name}</Text><Text style={styles.body}>{lawyer.email}</Text>{!!lawyer.phone && <Text style={styles.body}>{lawyer.phone}</Text>}<View style={styles.divider} /><Text style={styles.label}>{form.id} · {t(form.title)}</Text><Text style={styles.body}>{lawyer.note}</Text><Text style={styles.small}>{t("Free request · No payment in FillOut")}</Text></Card>
      {!!requestError && <Text accessibilityRole="alert" style={styles.error}>{t(requestError)}</Text>}
      {!requestReceipt && <>
        {delivery.cloud && <EmailAccess initialEmail={lawyer.email} disabled={sendingRequest} />}
        {delivery.available && <>
          <Notice>{t(delivery.cloud ? 'FillOut stores this request and manually passes the contact details, selected form and question shown above to an independent attorney for direct follow-up. Your draft PDFs and other answers are not included.' : 'By choosing Send request, you save your contact details, selected form and question in the local team inbox on this Mac.')}</Notice>
          <Pressable accessibilityRole="checkbox" accessibilityLabel={t('I agree that FillOut may share the details shown above with an independent attorney so they can contact me directly.')} accessibilityState={{ checked: attorneyConsent, disabled: sendingRequest }} disabled={sendingRequest} onPress={() => setAttorneyConsent(value => !value)} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 10 }}><Ionicons name={attorneyConsent ? 'checkbox' : 'square-outline'} size={24} color={colors.navy} /><Text style={[styles.body, { flex: 1 }]}>{t('I agree that FillOut may share the details shown above with an independent attorney so they can contact me directly.')}</Text></Pressable>
          <Button title={t(sendingRequest ? 'Saving request…' : 'Send request')} disabled={sendingRequest || !delivery.canSubmit || !attorneyConsent} icon="send-outline" onPress={() => void sendAttorneyRequest()} />
        </>}
        <Button title={t("Edit my request")} disabled={sendingRequest} variant="secondary" icon="create-outline" onPress={() => setRoute('attorney')} />
      </>}
      <Button title={t("Chat with our team")} disabled={sendingRequest} variant="secondary" onPress={onContact} />
      <Text style={styles.footnote}>{t(delivery.error || (delivery.checking ? 'Checking request delivery…' : delivery.cloud ? 'You remain in control: nothing is submitted until you choose Send request.' : delivery.available ? 'Send request saves your details to the inbox on this computer. It does not email a lawyer, schedule a consultation or collect payment.' : 'Request preview only. Sending is available from the locally hosted website; external delivery and scheduling are not connected.'))}</Text>
    </>;
  }

  const pickerOptions: { id: string; label: string }[] = picker === 'status' ? finder.statuses : selectedStatus?.goals || [];
  async function leavePreparation(destination: Route) {
    const saved = await loadDraft(form.id);
    latestDraft.current = saved || undefined; setInitialDraft(saved || undefined);
    setRoute(destination);
  }

  function withPayment(content: React.ReactNode) {
    if (mode !== 'ai' || qualification.status !== 'passed' || getAiPaymentKind(form.id) === 'free'
      || !['fullPreparation', 'aiIntro', 'interview', 'interviewReview'].includes(route)) return content;
    const saved = latestDraft.current || initialDraft;
    return <AiPaymentGate key={`${form.id}-${saved?.paymentCaseId || 'new'}`} formId={form.id}
      caseId={saved?.paymentCaseId} parentCaseId={saved?.paymentParentCaseId} isActive={isActive}
      applicationReturnRequest={applicationReturnRequest} onReturnToApplications={() => void returnToApplications()}
      onRecoverCase={async caseId => {
        const recovered = { ...(latestDraft.current || makeDraft('check')), paymentCaseId: caseId, paymentParentCaseId: undefined };
        if (!await autosave(recovered)) throw new Error('Save this application before continuing to payment.');
        setInitialDraft(recovered); setPreparationVersion(value => value + 1);
      }}
      onAccount={onAccount} onContact={onContact} onBack={() => setRoute('result')}>{content}</AiPaymentGate>;
  }

  const resumeNotice = resumeError ? <Notice tone="warning"><Text accessibilityRole="alert" style={styles.error}>{t(resumeError)}</Text><Button title={t("Retry opening saved draft")} variant="secondary" onPress={() => setResumeAttempt(value => value + 1)} /></Notice> : null;
  const preparationFeedback = <Modal visible={isActive && (loadingDraft || !!resumeError)} transparent animationType="fade" onRequestClose={() => { if (!loadingDraft) setResumeError(''); }}>
    <View style={[styles.modalOverlay, { justifyContent: 'center', padding: 20 }]}><Card>
      {loadingDraft ? <Notice title={t("Opening your saved draft")}>{t("Restoring your latest answers…")}</Notice> : <>{resumeNotice}<Button title={t("Keep working on this form")} variant="quiet" onPress={() => setResumeError('')} /></>}
    </Card></View>
  </Modal>;
  if (route === 'freePreparation') return <View style={styles.root}>{preparationFeedback}<FreeFormPreparationScreen key={`${form.id}-${preparationVersion}`} draftOwner={draftOwner} initialDraft={initialDraft} onSaveErrorChange={onSaveErrorChange} checks={answers} applicationReturnRequest={applicationReturnRequest} onExitToApplications={onExitToApplications} onDraftSaved={onDraftSaved} formId={form.id} officialUrl={form.officialUrl} isActive={isActive} onExit={() => { void leavePreparation('result').catch(() => setResumeError('Could not reopen your saved draft. Please try again.')); }} /></View>;
  if (route === 'fullPreparation') return withPayment(<View style={styles.root}>{preparationFeedback}<FullFormPreparationScreen key={`${form.id}-${preparationVersion}`} formId={form.id} reviewRequired={allowsReviewDraft(form.id,mode,schema,answers)} onAccount={onAccount} draftOwner={draftOwner} initialDraft={initialDraft} onSaveErrorChange={onSaveErrorChange} checks={answers} applicationReturnRequest={applicationReturnRequest} onExitToApplications={onExitToApplications} onDraftSaved={onDraftSaved} isActive={isActive} onExit={() => { void leavePreparation('detail').catch(() => setResumeError('Could not reopen your saved draft. Please try again.')); }} /></View>);
  const backLabels: Partial<Record<Route, string>> = { catalog: 'Home', finder: 'Home', detail: onExitToApplications ? 'My Application' : 'Forms', check: questionIndex ? 'Previous question' : 'Preparation options', result: 'Change last answer', aiIntro: 'Form check', interview: editingDraft ? 'Review answers' : fieldIndex ? 'Previous question' : 'Overview', interviewReview: 'Overview', attorney: 'Form check', attorneyPreview: 'Edit request' };
  return withPayment(<KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.scrollContent}>
      <View style={styles.content}>
        {resumeNotice}
        {route !== 'home' && <Pressable accessibilityRole="button" accessibilityLabel={t(backLabels[route] || 'Back')} accessibilityState={{ disabled: loadingDraft || savingDraft || sendingRequest }} disabled={loadingDraft || savingDraft || sendingRequest} onPress={goBack} style={styles.back}><Ionicons name="arrow-back" size={21} color={colors.navy} /><Text style={styles.backText}>{t(backLabels[route] || 'Back')}</Text></Pressable>}
        {!!draftError && <Notice tone="warning"><Text accessibilityRole="alert" style={styles.error}>{t(draftError)}</Text>{latestDraft.current && <Button title={t("Retry saving draft")} variant="secondary" onPress={() => { if (latestDraft.current) void autosave(latestDraft.current); }} />}</Notice>}
        {!!draftMessage && (route === 'interview' || route === 'interviewReview' || route === 'aiIntro') && <Notice tone="success">{t(draftMessage)}</Notice>}
        {loadingDraft ? <Notice title={t("Opening your saved draft")}>{t("Checking your saved answers against the current questions…")}</Notice> : <>
        {route === 'home' && home()}
        {route === 'catalog' && catalog()}
        {route === 'finder' && <><SectionTitle eyebrow={t("A GOOD PLACE TO START")} title={t("Find your form")} subtitle={t("Choose the situation that applies to you.")} />{finderCard()}<Button title={t("Browse all forms")} variant="secondary" onPress={() => setRoute('catalog')} /></>}
        {route === 'detail' && details()}
        {route === 'check' && checkScreen()}
        {route === 'result' && checkResult()}
        {route === 'aiIntro' && aiIntro()}
        {route === 'interview' && interviewScreen()}
        {route === 'interviewReview' && interviewReview()}
        {route === 'attorney' && attorneyIntake()}
        {route === 'attorneyPreview' && attorneyPreview()}
        </>}
      </View>
    </ScrollView>
    <Modal visible={isActive && guaranteeOpen} animationType="slide" transparent onRequestClose={() => setGuaranteeOpen(false)}>
      <View style={styles.modalOverlay}><Pressable accessibilityLabel={t("Close service terms")} accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={() => setGuaranteeOpen(false)} />
        <View style={styles.modalSheet} accessibilityViewIsModal>
          <View style={styles.metaRow}><Text accessibilityRole="header" style={styles.cardTitle}>{t("Service terms")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Close service terms")} onPress={() => setGuaranteeOpen(false)} style={{ padding: 10 }}><Ionicons name="close" size={25} color={colors.navy} /></Pressable></View>
          <ScrollView contentContainerStyle={{ gap: 16, paddingTop: 12, paddingBottom: 28 }}>
            <Text style={styles.body}>{t("A paid preparation purchase covers one application, guided questions and review by the FillOut team. Reopening the same paid application does not require another purchase.")}</Text>
            <Notice>{t("FillOut provides document preparation support, not legal advice or a guarantee of USCIS acceptance or approval. Review your completed document, required evidence and signatures before filing.")}</Notice>
            <Text style={styles.body}>{t("For App Store purchase refunds, submit a request to Apple. Eligibility and the refund decision are determined by Apple.")}</Text>
            <Button title={t("Request a refund from Apple")} variant="secondary" icon="open-outline" onPress={() => void openOfficial('https://reportaproblem.apple.com/', t)} />
            <Button title={t("Privacy Policy")} variant="quiet" icon="open-outline" onPress={() => void openOfficial('https://fillout.net/privacy/', t)} />
            <Button title={t("Full service terms")} variant="quiet" icon="open-outline" onPress={() => void openOfficial('https://fillout.net/terms/', t)} />
            <Text style={styles.small}>{t("Government filing fees are separate. Please review the current USCIS instructions and your completed form before you file.")}</Text>
            <Button title={t("Ask our team about preparation")} icon="chatbubble-ellipses-outline" onPress={() => { setGuaranteeOpen(false); onContact(); }} />
            <Button title={t("Done")} variant="secondary" onPress={() => setGuaranteeOpen(false)} />
          </ScrollView>
        </View>
      </View>
    </Modal>
    <Modal visible={isActive && picker !== null} animationType="slide" transparent onRequestClose={() => setPicker(null)}>
      <View style={styles.modalOverlay}><Pressable accessibilityLabel={t("Close choices")} accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
        <View style={styles.modalSheet} accessibilityViewIsModal>
          <View style={styles.metaRow}><Text accessibilityRole="header" style={styles.cardTitle}>{t(picker === 'status' ? 'I am…' : 'I would like to…')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Close choices")} onPress={() => setPicker(null)} style={{ padding: 10 }}><Ionicons name="close" size={25} color={colors.navy} /></Pressable></View>
          <ScrollView contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">{pickerOptions.map(item => {
            const selected = (picker === 'status' ? statusId : goalId) === item.id;
            return <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => { if (picker === 'status') { setStatusId(item.id); setGoalId(''); } else setGoalId(item.id); setFinderMatchesVisible(false); setPicker(null); }} style={[styles.optionRow, selected && { backgroundColor: colors.goldLight }]}><Text style={[styles.body, { flex: 1, color: colors.navy }]}>{t(item.label)}</Text><Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? colors.navy : colors.muted} /></Pressable>;
          })}</ScrollView>
        </View>
      </View>
    </Modal>
  </KeyboardAvoidingView>);
}

export default FormsFlow;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, alignItems: 'center' },
  content: { width: '100%', maxWidth: 680, gap: 14 },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  contactIcon: { width: 44, height: 44, flexShrink: 0, borderRadius: 22, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  hero: { backgroundColor: '#052A58', borderRadius: radius.lg, overflow: 'hidden' },
  heroContent: { padding: 20, gap: 14 },
  // The background fills the unpadded outer frame; spacing belongs to the inner content.
  backgroundImage: { borderRadius: radius.lg, width: '100%', height: '100%' },
  heroEyebrow: { color: '#F3D783', fontSize: 10, lineHeight: 17, fontWeight: '800', letterSpacing: 1.8 },
  heroTitle: { color: colors.paper, fontWeight: '800', fontSize: 35, lineHeight: 42, letterSpacing: -0.8 },
  heroCopy: { color: '#D2E0F3', fontSize: 15, lineHeight: 22 },
  heroTerms: { color: '#D2E0F3', fontSize: 10, lineHeight: 16, textDecorationLine: 'underline' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { color: colors.navy, fontSize: 20, fontWeight: '800', lineHeight: 27, flexShrink: 1 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  small: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  label: { color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  link: { color: colors.navy, fontSize: 13, fontWeight: '700', padding: 8 },
  eyebrow: { color: '#8E6E2B', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  finderCard: { padding: 16, gap: 14, borderRadius: 22, boxShadow: '0px 5px 18px rgba(7, 45, 96, 0.05)' },
  finderIcon: { width: 48, height: 52, backgroundColor: colors.blueLight, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  finderFields: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  selectorField: { flex: 1, minWidth: 0, gap: 5 },
  selectorLabel: { color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  selector: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FBFCFF' },
  selectorValue: { color: colors.text, fontSize: 12, lineHeight: 18, flex: 1 },
  pricedFormRow: { padding: 12, gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.paper, boxShadow: '0px 4px 14px rgba(7, 45, 96, 0.035)' },
  formInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  formCodeBadge: { backgroundColor: '#E5F0FF', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 9, minWidth: 60, alignItems: 'center' },
  formCode: { color: colors.navy, fontSize: 17, fontWeight: '800', lineHeight: 23 },
  formSummary: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  priceColumns: { flexDirection: 'row', gap: 7, alignItems: 'stretch' },
  priceColumn: { flex: 1, minWidth: 0, gap: 3, borderWidth: 1, borderColor: colors.blueBorder, backgroundColor: colors.blueLight, borderRadius: 11, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center' },
  attorneyPriceColumn: { borderColor: '#F0DFB7', backgroundColor: colors.cream },
  priceLabel: { color: '#405578', fontSize: 10, lineHeight: 14, textAlign: 'center' },
  listPrice: { maxWidth: '100%', flexShrink: 1, color: colors.navy, fontSize: 20, fontWeight: '800', lineHeight: 26, textAlign: 'center' },
  priceNote: { color: colors.muted, fontSize: 9, lineHeight: 12, textAlign: 'center' },
  priceGuarantee: { minHeight: 26, justifyContent: 'center' },
  priceGuaranteeText: { color: '#1469AB', fontSize: 9, lineHeight: 12, fontWeight: '600', textAlign: 'center' },
  otherFormsHeader: { minHeight: 64, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.paper },
  confidencePoints: { flexDirection: 'row', alignItems: 'stretch' },
  confidencePoint: { flex: 1, minWidth: 0, alignItems: 'center', gap: 5, paddingHorizontal: 5 },
  confidencePointBorder: { borderLeftWidth: 1, borderLeftColor: 'rgba(189, 215, 246, 0.25)' },
  confidencePointText: { color: '#F0F5FF', fontSize: 11, lineHeight: 16, textAlign: 'center' },
  confidenceBanner: { backgroundColor: '#052A58', borderRadius: radius.lg, overflow: 'hidden' },
  confidenceBannerContent: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10, gap: 14 },
  confidenceBannerTop: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  guaranteeBadge: { aspectRatio: 1, alignSelf: 'center' },
  confidenceTitle: { color: colors.paper, fontSize: 22, lineHeight: 27, fontWeight: '800', letterSpacing: -0.45 },
  confidenceCopy: { color: '#D2E0F3', fontSize: 13, lineHeight: 20 },
  guaranteeLink: { flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', minHeight: 34 },
  guaranteeLinkText: { color: '#F3D783', fontSize: 11, lineHeight: 17, textAlign: 'center', textDecorationLine: 'underline', flexShrink: 1 },
  whyCard: { padding: 18, gap: 14, borderRadius: 22 },
  whyTitle: { color: colors.navy, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.7 },
  goldLine: { height: 4, width: 100, backgroundColor: colors.gold, borderRadius: 3 },
  reasonCards: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  reasonCard: { flex: 1, gap: 6, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 16, alignItems: 'center' },
  reasonTitle: { color: colors.navy, fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  reasonCopy: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  homeFooter: { paddingTop: 10, gap: 6, borderTopWidth: 1, borderTopColor: colors.border },
  footerText: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  fileIcon: { width: 43, height: 46, backgroundColor: '#EEF2F7', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  formId: { color: '#8E6E2B', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  rowTitle: { color: colors.navy, fontSize: 17, fontWeight: '800', lineHeight: 23 },
  benefitIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: colors.goldLight, justifyContent: 'center', alignItems: 'center' },
  footnote: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  error: { color: colors.error, fontSize: 14, lineHeight: 21 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 42, alignSelf: 'flex-start' },
  backText: { color: colors.navy, fontSize: 14, fontWeight: '600' },
  chip: { paddingVertical: 10, paddingHorizontal: 17, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border, borderRadius: 25 },
  chipSelected: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { color: colors.navy, fontSize: 13, fontWeight: '600' },
  price: { color: colors.navy, fontSize: 32, fontWeight: '800', letterSpacing: -0.8 },
  compactPrice: { color: colors.navy, fontSize: 21, fontWeight: '800' },
  progressTrack: { height: 5, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 5, backgroundColor: colors.gold, borderRadius: 4 },
  question: { color: colors.navy, fontSize: 23, lineHeight: 32, fontWeight: '700' },
  resultIcon: { width: 82, height: 82, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  divider: { height: 1, backgroundColor: colors.border },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(3,15,36,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 25, borderTopRightRadius: 25, paddingHorizontal: 20, paddingTop: 14, maxHeight: '80%' },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 15, minHeight: 59, borderRadius: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
