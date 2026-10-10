import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, Alert, BackHandler, Image, ImageBackground, KeyboardAvoidingView, Linking, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
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

type Route = 'home' | 'catalog' | 'finder' | 'detail' | 'check' | 'result' | 'aiIntro' | 'interview' | 'interviewReview' | 'attorney' | 'attorneyPreview';
type PickerKind = 'status' | 'goal' | null;
type Props = {
  onContact: () => void;
  onDraftSaved?: (draft: DraftSummary) => void;
  isActive?: boolean;
  initialFormId?: string;
  resumeFormId?: string;
  resumeRequest?: number;
};

const forms = catalogFile.forms as FormRecord[];
const checks = [...mainChecksFile.forms, ...otherChecksFile.forms] as QualificationSchema[];
const finder: any = finderFile;
const pricing: any = pricingFile;
const attorneys: any = attorneyFile;
const interviews: any = interviewFile;
const modeNames: Record<PreparationMode, string> = { self: 'Do it yourself', ai: 'Prepare with AI', attorney: 'Prepare with an attorney' };
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

function aiOffer(id: string) {
  const item = pricing.forms.find((record: any) => record.id === id);
  const reference = item.citizenPath;
  const target = reference.includedWith?.[0] || reference.requiredPackage;
  const parent = target ? pricing.forms.find((record: any) => record.id === target) : undefined;
  const amount = item.eagleAi.serviceAmountUsd30;
  if (reference.status === 'not-offered') return { price: 'Ask our team', note: 'Availability needs confirmation', unavailable: true, target: null };
  if (reference.status === 'included') return { price: money(parent?.eagleAi.serviceAmountUsd30), note: `Included in ${target} · full package price`, unavailable: false, target };
  if (reference.status === 'add-on') return { price: '+' + money(amount), note: `Add-on to ${target} (${money(parent?.eagleAi.serviceAmountUsd30)})`, unavailable: false, target };
  return { price: money(amount), note: amount === 0 ? 'No preparation charge' : 'One-time preparation fee', unavailable: false, target: null };
}

async function openOfficial(url?: string | null) {
  if (!url) return;
  try { await Linking.openURL(url); }
  catch { Alert.alert('Unable to open this link', 'Please try again when your connection is available.'); }
}

export function FormsFlow({ onContact, onDraftSaved, isActive = true, initialFormId, resumeFormId, resumeRequest }: Props) {
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
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [fieldIndex, setFieldIndex] = useState(0);
  const [fieldError, setFieldError] = useState('');
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftFinished, setDraftFinished] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [draftError, setDraftError] = useState('');
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [lawyer, setLawyer] = useState({ name: '', email: '', phone: '', note: '' });
  const [lawyerErrors, setLawyerErrors] = useState<Record<string, string>>({});
  const [sendingRequest, setSendingRequest] = useState(false);
  const [requestReceipt, setRequestReceipt] = useState<RequestReceipt | null>(null);
  const [requestError, setRequestError] = useState('');
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
  const progress = draftProgress(fields, draft);
  const selectedStatus = finder.statuses.find((item: any) => item.id === statusId);
  const selectedGoal = selectedStatus?.goals.find((item: any) => item.id === goalId);
  const visibleForms = useMemo(() => forms.filter(item => {
    return (category === 'All' || item.category === category) && matchesFormSearch(item, search, formLabels[item.id]);
  }), [search, category]);

  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [route, formId, questionIndex, fieldIndex]);

  useEffect(() => {
    const userId = delivery.user?.id;
    if (previousRequestUser.current && previousRequestUser.current !== userId) {
      requestGeneration.current += 1;
      sendingRequestRef.current = false; setSendingRequest(false);
      setLawyer({ name: '', email: '', phone: '', note: '' }); setLawyerErrors({});
      setRequestReceipt(null); setRequestError(''); requestIdentity.reset();
      setRoute(current => current === 'attorneyPreview' ? 'attorney' : current);
    }
    previousRequestUser.current = userId;
  }, [delivery.user?.id]);
  useEffect(() => () => { requestGeneration.current += 1; }, []);

  useEffect(() => {
    if (!resumeRequest) return;
    let active = true;
    setLoadingDraft(true); setDraftError(''); setDraftMessage(''); setPicker(null);
    loadDraft(resumeFormId).then(saved => {
      if (!active) return;
      if (!saved) throw new Error('This saved draft is no longer available. Choose a form to start again.');
      const restoredForm = forms.find(item => item.id === saved.formId);
      if (!restoredForm) throw new Error('This saved form is not in the current catalog. Your stored draft has not been changed.');
      const restoredSchema = checks.find(item => item.id === saved.formId);
      const restoredFields = (interviews.forms.find((item: any) => item.id === saved.formId)?.fields || []) as PreparationField[];
      const restored = draftResume(restoredSchema, saved.checks, restoredFields, saved.answers);
      const restoredOffer = aiOffer(saved.formId);
      setFormId(saved.formId); setReturnTo('home'); setMode('ai');
      setDrafts(previous => ({ ...previous, [saved.formId]: { ...saved.answers } }));
      setAnswers({ ...saved.checks }); setQuestionIndex(restored.qualification.index);
      setFieldIndex(Math.max(0, restored.progress.firstInvalid)); setFieldError('');
      setEditingDraft(false); setShowCheckAnswers(false); setDraftFinished(restored.progress.complete);
      setDraftMessage('Loaded your saved draft. Changes are saved only when you choose Save.');
      setRequestReceipt(null); setRequestError(''); requestIdentity.reset();
      if (restored.qualification.status === 'passed' && !restoredOffer.unavailable && !restoredOffer.target) {
        setRoute(restored.progress.complete ? 'interviewReview' : 'interview');
      } else {
        setRoute(restored.qualification.status === 'checking' ? 'check' : 'result');
      }
    }).catch(error => {
      if (active) setDraftError(error instanceof Error ? error.message : 'Your saved draft could not be opened. Please try again.');
    }).finally(() => { if (active) setLoadingDraft(false); });
    return () => { active = false; };
  }, [resumeFormId, resumeRequest]);

  function openForm(id: string, origin: Route = route) {
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
  }

  function goBack() {
    if (savingDraftRef.current || sendingRequestRef.current || loadingDraft) return true;
    if (route === 'home') return false;
    if (route === 'catalog' || route === 'finder') setRoute('home');
    else if (route === 'detail') setRoute(returnTo === 'home' || returnTo === 'finder' ? returnTo : 'catalog');
    else if (route === 'check') { if (questionIndex > 0) editCheck(questionIndex - 1); else setRoute('detail'); }
    else if (route === 'result') editCheck(Math.min(qualification.index, (schema?.questions.length || 1) - 1));
    else if (route === 'aiIntro' || route === 'attorney') setRoute('result');
    else if (route === 'interview') { setFieldError(''); if (editingDraft) setRoute('interviewReview'); else if (fieldIndex > 0) setFieldIndex(fieldIndex - 1); else setRoute('aiIntro'); }
    else if (route === 'interviewReview') setRoute('aiIntro');
    else if (route === 'attorneyPreview') setRoute('attorney');
    return true;
  }

  useEffect(() => {
    if (!isActive) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => subscription.remove();
  }, [isActive, route, questionIndex, fieldIndex, editingDraft, returnTo, qualification.index, answers, loadingDraft]);

  function startCheck(selectedMode: PreparationMode) {
    setMode(selectedMode); setAnswers({}); setQuestionIndex(0); setShowCheckAnswers(false);
    setRequestReceipt(null); setRequestError(''); requestIdentity.reset();
    setRoute(schema?.questions.length ? 'check' : 'result');
  }

  function answerCheck(answer: QualificationAnswer) {
    if (!question) return;
    const updated = { ...answers, [question.id]: answer };
    setAnswers(updated);
    const next = evaluateQualification(schema, updated);
    if (next.status === 'checking') setQuestionIndex(next.index);
    else setRoute('result');
  }

  function continueFromCheck() {
    if (qualification.status !== 'passed') return;
    if (mode === 'self') { void openOfficial(schema?.pdfUrl || form.officialUrl); return; }
    if (mode === 'attorney') { setLawyerErrors({}); setRoute('attorney'); return; }
    if (offer.unavailable) { onContact(); return; }
    if (offer.target) { openForm(offer.target, 'catalog'); return; }
    setRoute('aiIntro');
  }

  function saveField() {
    if (!field) return;
    const error = validateField(field, draft[field.id] || '');
    if (error) { setFieldError(error); return; }
    setFieldError('');
    if (editingDraft || fieldIndex === fields.length - 1) { setEditingDraft(false); setRoute('interviewReview'); }
    else setFieldIndex(fieldIndex + 1);
  }

  async function persistDraft(finish = false) {
    if (savingDraftRef.current) return;
    if (qualification.status !== 'passed') { setDraftError('Complete the form check before saving this preparation draft.'); return; }
    if (finish && progress.firstInvalid >= 0) {
      const invalid = fields[progress.firstInvalid];
      setFieldIndex(progress.firstInvalid); setFieldError(validateField(invalid, draft[invalid.id] || '') || 'Please complete this answer.');
      setEditingDraft(true); setRoute('interview'); return;
    }
    const saved: SavedDraft = {
      version: 1, formId: form.id, title: form.title, answered: progress.answered, total: fields.length,
      updatedAt: new Date().toISOString(), answers: { ...draft }, checks: { ...answers },
    };
    savingDraftRef.current = true; setSavingDraft(true); setDraftError(''); setDraftMessage('');
    try {
      await saveDraft(saved);
      setDraftFinished(finish);
      setDraftMessage('Saved on this device. Resume this draft from My Application.');
      onDraftSaved?.(saved);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : 'Your draft could not be saved. Keep this screen open and try again.');
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
    if (!Object.keys(errors).length) { setRequestReceipt(null); setRequestError(''); setRoute('attorneyPreview'); }
  }

  async function sendAttorneyRequest() {
    if (sendingRequestRef.current || requestReceipt || !delivery.canSubmit) return;
    const generation = requestGeneration.current;
    sendingRequestRef.current = true; setSendingRequest(true); setRequestError('');
    try {
      const payload = {
        type: 'attorney' as const, name: lawyer.name.trim(), email: lawyer.email.trim(), phone: lawyer.phone.trim() || undefined,
        question: lawyer.note.trim(), formId: form.id,
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
      <View style={styles.priceColumn}><Text style={styles.priceLabel}>Do it yourself</Text><Text style={styles.listPrice}>Free</Text></View>
      <View style={styles.priceColumn}><Text style={styles.priceLabel}>With AI</Text><Text style={styles.listPrice}>{ai.unavailable ? 'Contact us' : ai.price}</Text>{!!detail && <Text style={styles.priceNote}>{detail}</Text>}{!ai.unavailable && <Pressable accessibilityRole="button" accessibilityLabel={`Read preparation guarantee terms for ${item.id}`} onPress={() => setGuaranteeOpen(true)} style={styles.priceGuarantee}><Text style={styles.priceGuaranteeText}>Preparation guarantee*</Text></Pressable>}</View>
      <View style={[styles.priceColumn, styles.attorneyPriceColumn]}><Text style={styles.priceLabel}>With an attorney</Text><Text style={styles.listPrice}>{typeof lawyerPrice === 'number' ? money(lawyerPrice) : 'Get a quote'}</Text>{typeof lawyerPrice === 'number' && !!attorneyScope[item.id] && <Text style={styles.priceNote}>{attorneyScope[item.id]}</Text>}</View>
    </View>;
  }

  function pricedFormRow(item: FormRecord, shortTitle: boolean) {
    return <View key={item.id} style={styles.pricedFormRow}>
      <View style={styles.formInfo}><View style={styles.formCodeBadge}><Text style={styles.formCode}>{item.id}</Text></View><View style={{ flex: 1, gap: 4 }}><Text accessibilityRole="header" style={styles.rowTitle}>{shortTitle ? formLabels[item.id] || item.title : item.title}</Text><Text style={styles.formSummary}>{item.summary}</Text></View></View>
      {formPriceSummary(item)}
      <Button title="Start filling out form" accessibilityLabel={`Start filling out form ${item.id}`} icon="arrow-forward" onPress={() => openForm(item.id)} />
    </View>;
  }

  function formRow(item: FormRecord) {
    return pricedFormRow(item, false);
  }

  function homeForms() {
    const mainForms = mainFormIds.map(id => forms.find(item => item.id === id)).filter((item): item is FormRecord => !!item);
    const otherForms = forms.filter(item => !mainFormIds.includes(item.id));
    return <View style={{ gap: 17 }}>
      <SectionTitle eyebrow="YOUR FORM. YOUR WAY." title="Immigration forms" subtitle="Choose free self-preparation, AI guidance or attorney assistance." />
      <Button title="Search by form number or name" variant="secondary" icon="search-outline" onPress={() => setRoute('catalog')} />
      <Text accessibilityRole="header" style={styles.label}>Main forms</Text>
      {mainForms.map(item => pricedFormRow(item, true))}
      <Pressable accessibilityRole="button" accessibilityLabel={`All other forms, ${otherForms.length} documents`} accessibilityState={{ expanded: otherFormsOpen }} onPress={() => setOtherFormsOpen(!otherFormsOpen)} style={styles.otherFormsHeader}>
        <View style={{ flex: 1, gap: 3 }}><Text style={styles.label}>All other forms</Text><Text style={styles.small}>Compare all three preparation options</Text></View><Badge>{otherForms.length}</Badge><Ionicons name={otherFormsOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.navy} />
      </Pressable>
      {otherFormsOpen && otherForms.map(item => pricedFormRow(item, true))}
      <Text style={styles.footnote}>Prices in USD. Government filing fees and taxes are separate. Paid services are not available during this preview.</Text>
    </View>;
  }

  function selector(kind: 'status' | 'goal', label: string, value: string | undefined, placeholder: string) {
    const disabled = kind === 'goal' && !selectedStatus;
    return <View style={styles.selectorField}><Text style={styles.selectorLabel}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${value || placeholder}`} accessibilityState={{ disabled, expanded: picker === kind }} disabled={disabled} onPress={() => setPicker(kind)} style={[styles.selector, disabled && { opacity: 0.6 }]}>
        <Text style={[styles.selectorValue, !value && { color: colors.muted }]}>{value || placeholder}</Text><Ionicons name="chevron-down" size={17} color={colors.navy} />
      </Pressable>
    </View>;
  }

  function showFormMatches() {
    if (!selectedStatus) { setPicker('status'); return; }
    if (!selectedGoal) { setPicker('goal'); return; }
    setFinderMatchesVisible(true);
    AccessibilityInfo.announceForAccessibility(`${selectedGoal.forms.length} matching forms found below.`);
  }

  function finderCard() {
    return <Card style={styles.finderCard}>
      <View style={styles.sectionHeading}><View style={styles.finderIcon}><Ionicons name="search-outline" color={colors.navy} size={27} /></View><View style={{ flex: 1, gap: 5 }}><Text accessibilityRole="header" style={styles.cardTitle}>Find the right USCIS form</Text><Text style={styles.small}>Tell us about your situation to get started.</Text></View></View>
      <View style={styles.finderFields}>
        {selector('status', 'I am', selectedStatus?.label, 'Choose your status')}
        {selector('goal', 'I would like to', selectedGoal?.label, 'Choose what to do')}
      </View>
      <Button title="Find My Form" icon="arrow-forward" onPress={showFormMatches} />
      {finderMatchesVisible && !!selectedGoal && <View style={{ gap: 12 }} accessibilityLiveRegion="polite"><Text style={styles.eyebrow}>YOUR MATCH</Text>{selectedGoal.forms.map((id: string) => forms.find(item => item.id === id)).filter(Boolean).map(formRow)}<Text style={styles.small}>A form match is a starting point. A short check follows before preparation.</Text></View>}
      {!!statusId && <Button title="Reset choices" variant="quiet" onPress={() => { setStatusId(''); setGoalId(''); setFinderMatchesVisible(false); }} />}
    </Card>;
  }

  function confidencePoints() {
    const points: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
      { icon: 'shield-checkmark-outline', label: 'Accurate\nforms' },
      { icon: 'time-outline', label: 'Save\ntime' },
      { icon: 'people-outline', label: 'Clear\nguidance' },
    ];
    return <View style={styles.confidencePoints}>{points.map((point, index) => <View key={point.label} style={[styles.confidencePoint, index > 0 && styles.confidencePointBorder]}><Ionicons name={point.icon} size={25} color="#F0F5FF" /><Text style={styles.confidencePointText}>{point.label}</Text></View>)}</View>;
  }

  function confidenceSection() {
    return <View style={{ gap: 18 }}>
      <ImageBackground source={require('../../assets/fillout-hero-bg.jpg')} style={styles.confidenceBanner} imageStyle={styles.backgroundImage}>
        <View style={styles.confidenceBannerTop}>
          <Image source={require('../../assets/fillout-guarantee-badge.png')} style={[styles.guaranteeBadge, { width: (contentWidth - 40) * 0.35, height: (contentWidth - 40) * 0.35 }]} resizeMode="contain" accessibilityLabel="FILLOUT preparation guarantee shield" />
          <View style={{ flex: 1, gap: 12 }}><Text accessibilityRole="header" style={styles.confidenceTitle}>File your immigration forms with <Text style={{ color: colors.gold }}>confidence.</Text></Text><Text style={styles.confidenceCopy}>Accurate forms. Clear guidance. A simpler way forward.</Text></View>
        </View>
        {confidencePoints()}
        <Pressable accessibilityRole="button" onPress={() => setGuaranteeOpen(true)} style={styles.guaranteeLink}><Text style={styles.guaranteeLinkText}>Preparation guarantee* · Read terms</Text><Ionicons name="arrow-forward" size={15} color="#F3D783" /></Pressable>
      </ImageBackground>
      <Card style={styles.whyCard}>
        <View style={{ gap: 10 }}><Text accessibilityRole="header" style={styles.whyTitle}>Why it matters</Text><View style={styles.goldLine} /><Text style={styles.body}>Small details deserve a careful check. Start with the right form, read the current instructions and review your answers before filing.</Text></View>
        <View style={styles.reasonCards}>
          <View style={[styles.reasonCard, { backgroundColor: '#FFF2F3' }]}><Ionicons name="document-text-outline" size={35} color="#B24C5C" /><Text style={styles.reasonTitle}>Complete details</Text><Text style={styles.reasonCopy}>Check required answers and signatures.</Text></View>
          <View style={[styles.reasonCard, { backgroundColor: '#FFF8E9' }]}><Ionicons name="documents-outline" size={35} color="#A47B31" /><Text style={styles.reasonTitle}>Current forms</Text><Text style={styles.reasonCopy}>Check the edition and filing instructions.</Text></View>
        </View>
        <Button title="File the Right Form" icon="arrow-forward" onPress={() => setRoute('finder')} />
      </Card>
    </View>;
  }

  function home() {
    const benefits: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
      { icon: 'search-outline', title: 'Find your starting point', text: 'Match your situation with a form and work through a short preliminary check.' },
      { icon: 'document-text-outline', title: 'Official USCIS forms', text: 'Open the official document and current USCIS instructions for your form.' },
      { icon: 'list-outline', title: 'One question at a time', text: 'Answer guided introductory questions and review your preparation draft.' },
      { icon: 'save-outline', title: 'Pick up where you left off', text: 'Save a draft on this device and return to it in My Application.' },
      { icon: 'create-outline', title: 'Free self-preparation', text: 'Use official USCIS documents at no FILLOUT preparation charge. Government fees may apply.' },
      { icon: 'chatbubbles-outline', title: 'Contact our team', text: 'Review a question and your contact details before sending a support request.' },
    ];
    return <>
      <View style={styles.topLine}><BrandMark width={Math.min(contentWidth - 56, 370)} /><Pressable accessibilityRole="button" accessibilityLabel="Contact our team" onPress={onContact} style={styles.contactIcon}><Ionicons name="chatbubble-ellipses-outline" size={23} color={colors.navy} /></Pressable></View>
      <ImageBackground source={require('../../assets/fillout-hero-bg.jpg')} style={styles.hero} imageStyle={styles.backgroundImage}>
        <Text style={styles.heroEyebrow}>IMMIGRATION MADE SIMPLE</Text>
        <Text accessibilityRole="header" style={[styles.heroTitle, { fontSize: contentWidth < 315 ? 27 : contentWidth > 470 ? 43 : 29, lineHeight: contentWidth < 315 ? 34 : contentWidth > 470 ? 51 : 36 }]}>Prepare immigration paperwork correctly, <Text style={{ color: colors.gold }}>guaranteed.</Text></Text>
        <Text style={styles.heroCopy}>Find your form. Follow clear steps.{'\n'}Move forward with confidence.</Text>
        {confidencePoints()}
        <Pressable accessibilityRole="button" accessibilityLabel="Read preparation guarantee terms" onPress={() => setGuaranteeOpen(true)}><Text style={styles.heroTerms}>*Preparation guarantee · Terms apply</Text></Pressable>
      </ImageBackground>
      {finderCard()}
      {confidenceSection()}
      {homeForms()}
      <SectionTitle eyebrow="SUPPORT AT EVERY STEP" title="A clearer path to your paperwork" />
      <Card style={{ gap: 24 }}>{benefits.map(item => <View key={item.title} style={{ flexDirection: 'row', gap: 14 }}><View style={styles.benefitIcon}><Ionicons name={item.icon} size={21} color={colors.navy} /></View><View style={{ flex: 1, gap: 5 }}><Text style={styles.label}>{item.title}</Text><Text style={styles.small}>{item.text}</Text></View></View>)}</Card>
      <View style={styles.homeFooter}><BrandMark width={235} /><Text style={styles.footnote}>FILLOUT is not affiliated with USCIS or any government agency. A form check does not decide legal eligibility or guarantee approval.</Text><Button title="Contact our team" variant="secondary" icon="chatbubble-ellipses-outline" onPress={onContact} /><Text style={styles.footnote}>Early access · Guided drafts and official documents are available. Paid preparation, shipping and government filing are not connected.</Text></View>
    </>;
  }

  function catalog() {
    return <><SectionTitle eyebrow="YOUR DOCUMENTS, ONE PLACE" title="Find your next step" subtitle="Explore all 21 forms and supporting documents." />
      <Field label="Search forms" placeholder="Try N-400, citizenship or work permit" value={search} onChangeText={setSearch} autoCorrect={false} clearButtonMode="while-editing" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>{categories.map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: item === category }} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipSelected]}><Text style={[styles.chipText, category === item && { color: colors.paper }]}>{item}</Text></Pressable>)}</ScrollView>
      <Button title="Help me choose a form" variant="secondary" icon="search-outline" onPress={() => setRoute('finder')} />
      <Text accessibilityLiveRegion="polite" style={styles.small}>{visibleForms.length} {visibleForms.length === 1 ? 'document' : 'documents'}</Text>
      {visibleForms.length ? <View style={{ gap: 16 }}>{visibleForms.map(formRow)}</View> : <Notice title="No forms found">Try a form number or a broader search, such as family or travel.</Notice>}
      {(!!search || category !== 'All') && <Button title="Clear search and filters" variant="quiet" onPress={() => { setSearch(''); setCategory('All'); }} />}
      <Text style={styles.footnote}>Government filing fees are separate from preparation services.</Text>
    </>;
  }

  function details() {
    return <><Badge gold>{form.id} · {form.category}</Badge><SectionTitle title={form.title} subtitle={form.summary} />
      <Text style={styles.body}>Choose how you’d like to prepare. Every option starts with a short form check.</Text>
      <Card><View style={styles.sectionHeading}><Ionicons name="create-outline" size={25} color={colors.navy} /><Text style={styles.cardTitle}>Do it yourself</Text></View><Text style={styles.price}>Free</Text><Text style={styles.small}>No preparation charge</Text><Text style={styles.body}>Complete the official USCIS document yourself using its instructions.</Text><Button title="Start free form check" variant="secondary" onPress={() => startCheck('self')} /></Card>
      <Card style={{ borderColor: colors.gold, borderWidth: 1.5 }}><View style={styles.sectionHeading}><Ionicons name="sparkles-outline" size={25} color={colors.navy} /><Text style={styles.cardTitle}>Prepare with AI</Text></View><Text style={styles.price}>{offer.price}</Text><Text style={styles.small}>{offer.note}</Text><Text style={styles.body}>{offer.unavailable ? 'Check the form and ask our team about available preparation help.' : offer.target ? 'This document is prepared with its related application package.' : 'Answer one question at a time and review your preparation draft.'}</Text><Button title="Check & prepare with AI" variant="gold" onPress={() => startCheck('ai')} /><Text style={styles.footnote}>This MVP uses guided questions. Live AI and payment are not connected.</Text></Card>
      <Card><View style={styles.sectionHeading}><Ionicons name="briefcase-outline" size={25} color={colors.navy} /><Text style={styles.cardTitle}>Prepare with an attorney</Text></View><Text style={styles.price}>{money(attorney?.servicePriceUsd)}</Text><Text style={styles.small}>{attorney?.status === 'fixed' ? 'Company service price' : 'We’ll confirm the scope and price'}</Text><Text style={styles.body}>{attorney?.benchmark?.scope || 'Get individual help for your situation.'}</Text><Button title="Check & request attorney help" variant="secondary" onPress={() => startCheck('attorney')} /></Card>
      <Text style={styles.footnote}>Preparation fees only. Government fees and taxes are separate. No payment is collected in this preview.</Text>
      <Button title="View official USCIS information" variant="quiet" icon="open-outline" onPress={() => void openOfficial(form.officialUrl)} />
    </>;
  }

  function checkScreen() {
    if (!question || !schema) return <Notice title="Review needed">Please contact our team to review this form.</Notice>;
    return <><Badge>{form.id} · {modeNames[mode]}</Badge><SectionTitle title="Let’s check your starting point" subtitle="A few questions help us find the right preparation path." />
      <View style={{ gap: 9 }}><Text style={styles.small}>Question {questionIndex + 1} of {schema.questions.length}</Text><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${(questionIndex + 1) / schema.questions.length * 100}%` }]} /></View></View>
      <Card><Text accessibilityRole="header" style={styles.question}>{question.text}</Text>{!!question.help && <Text style={styles.body}>{question.help}</Text>}<View style={{ gap: 10 }}><Button title="Yes" onPress={() => answerCheck('yes')} /><Button title="No" variant="secondary" onPress={() => answerCheck('no')} /><Button title="I’m not sure — request review" variant="quiet" onPress={() => answerCheck('unsure')} /></View></Card>
      <Notice>This is a preliminary form check. It does not decide your legal eligibility or guarantee USCIS approval.</Notice>
      <Button title="Read the USCIS requirements" variant="quiet" icon="open-outline" onPress={() => void openOfficial(schema.sourceUrl)} />
    </>;
  }

  function checkResult() {
    const passed = qualification.status === 'passed';
    const stopped = qualification.status === 'stopped';
    const title = passed ? 'Congratulations!' : stopped ? 'Sorry, this form isn’t a match' : 'Your situation needs a closer look';
    const reason = passed ? 'Your answers fit this preliminary preparation path. The full USCIS requirements and your documents still need to be checked.' : qualification.reason;
    const primary = mode === 'self' ? (schema?.pdfUrl ? 'Open fillable USCIS PDF' : 'Open official USCIS service') : mode === 'attorney' ? 'Continue to attorney intake' : offer.unavailable ? 'Ask our team about preparation' : offer.target ? `View ${offer.target} package` : 'Continue to guided preparation';
    return <><Badge>{form.id} · {modeNames[mode]}</Badge><View style={[styles.resultIcon, { backgroundColor: passed ? colors.successLight : colors.goldLight }]}><Ionicons name={passed ? 'checkmark-circle-outline' : stopped ? 'compass-outline' : 'chatbubbles-outline'} size={45} color={passed ? colors.success : colors.navy} /></View><SectionTitle title={title} subtitle={reason} />
      {passed ? <><Button title={primary} variant={mode === 'ai' ? 'gold' : 'primary'} icon={mode === 'self' ? 'open-outline' : 'arrow-forward'} onPress={continueFromCheck} />{mode === 'self' && <Text style={styles.small}>The official document opens outside this app. Use a PDF reader that supports fillable USCIS forms and check the current edition before filing.</Text>}{mode === 'ai' && !!offer.target && <Notice>The related package has its own form check. This supplement is not a separate purchase.</Notice>}</> : <><Notice tone="warning">This result is not a decision that you are ineligible for an immigration benefit. Exceptions or another process may apply.</Notice><Button title="Contact our team" onPress={onContact} /><Button title="Explore other forms" variant="secondary" onPress={() => setRoute('catalog')} /></>}
      <Card><RowLink title={showCheckAnswers ? 'Hide your answers' : 'Review or change your answers'} onPress={() => setShowCheckAnswers(!showCheckAnswers)} icon={showCheckAnswers ? 'chevron-up' : 'chevron-down'} />{showCheckAnswers && schema?.questions.map((item, index) => answers[item.id] ? <RowLink key={item.id} title={item.text} subtitle={answers[item.id] === 'unsure' ? 'Not sure · Tap to change' : `${answers[item.id] === 'yes' ? 'Yes' : 'No'} · Tap to change`} onPress={() => editCheck(index)} icon="create-outline" /> : null)}</Card>
      <Button title="Back to preparation options" variant="quiet" onPress={() => setRoute('detail')} />
    </>;
  }

  function aiIntro() {
    return <><Badge gold>{form.id} · GUIDED PREPARATION</Badge><SectionTitle title="One question at a time" subtitle="Build a clear draft of your information before completing your application." />
      <Card><View style={styles.sectionHeading}><BrandMark compact /><View style={{ flex: 1 }}><Text style={styles.cardTitle}>FILLOUT preparation</Text><Text style={styles.small}>{interview?.subject}</Text></View></View>
        <View style={styles.metaRow}><Text style={styles.body}>{fields.length} starting questions</Text><Text style={styles.label}>{offer.price}</Text></View>
        <Text style={styles.small}>{progress.answered ? `${progress.answered} of ${fields.length} answers completed.` : 'You can review and edit every answer.'}</Text>
        <Button title={Object.keys(draft).length ? 'Continue my draft' : 'Start the questions'} variant="gold" icon="arrow-forward" onPress={() => {
          setFieldIndex(Math.max(0, progress.firstInvalid)); setEditingDraft(false); setFieldError('');
          setRoute(progress.complete ? 'interviewReview' : 'interview');
        }} />
      </Card>
      <Notice title="About this preview">This is a guided intake, not a live AI conversation. Choose Save for later to keep a draft on this device. Nothing is sent, charged or filed, and the draft does not generate a completed USCIS form.</Notice>
    </>;
  }

  function interviewScreen() {
    if (!field) return <Notice title="Draft unavailable">Contact our team for help with this document.</Notice>;
    const inputType = field.type;
    return <><Badge gold>{form.id} · PREPARATION DRAFT</Badge><View style={styles.metaRow}><Text style={styles.small}>{editingDraft ? 'Edit your answer' : `Question ${fieldIndex + 1} of ${fields.length}`}</Text><Text style={styles.small}>Save to keep your draft</Text></View><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${(fieldIndex + 1) / fields.length * 100}%` }]} /></View><SectionTitle title={field.label} />
      <Field label={inputType === 'date' ? 'Date · MM/DD/YYYY' : 'Your answer'} help={field.help} value={draft[field.id] || ''} editable={!savingDraft} onChangeText={value => { setDrafts(previous => ({ ...previous, [form.id]: { ...(previous[form.id] || {}), [field.id]: value } })); if (fieldError) setFieldError(''); setDraftFinished(false); setDraftMessage(''); setDraftError(''); }}
        placeholder={inputType === 'date' ? 'MM/DD/YYYY' : inputType === 'email' ? 'name@example.com' : inputType === 'tel' ? '+1 (555) 000-0000' : 'Enter your answer'}
        multiline={inputType === 'textarea'} autoCapitalize={inputType === 'email' ? 'none' : 'sentences'} keyboardType={inputType === 'email' ? 'email-address' : inputType === 'tel' ? 'phone-pad' : inputType === 'date' ? 'numbers-and-punctuation' : 'default'}
        maxLength={inputType === 'textarea' ? 2000 : inputType === 'date' ? 10 : 300} error={fieldError} />
      <Button title={editingDraft ? 'Update answer' : fieldIndex === fields.length - 1 ? 'Review my answers' : 'Next question'} disabled={savingDraft} variant="gold" icon="arrow-forward" onPress={saveField} />
      <Button title={savingDraft ? 'Saving…' : 'Save for later'} disabled={savingDraft} variant="secondary" icon="bookmark-outline" onPress={() => void persistDraft()} />
      <Text style={styles.footnote}>Enter accurate information. If a question does not fit your situation, contact our team for help.</Text>
    </>;
  }

  function interviewReview() {
    return <><Badge gold>{form.id} · PREPARATION DRAFT</Badge><SectionTitle title={draftFinished ? 'Your draft is ready to revisit' : 'Review your answers'} subtitle="Tap an answer to make a correction." />
      {draftFinished && <Notice tone="success" title="Draft saved on this device">You can reopen your answers from My Application. No application has been generated or filed.</Notice>}
      <Card style={{ paddingVertical: 3 }}>{fields.map((item, index) => <RowLink key={item.id} title={item.label} subtitle={draft[item.id] || 'Not answered'} onPress={() => { if (savingDraft) return; setFieldIndex(index); setEditingDraft(true); setFieldError(''); setDraftMessage(''); setRoute('interview'); }} icon="create-outline" />)}</Card>
      {!draftFinished && <><Button title={savingDraft ? 'Saving…' : 'Save reviewed draft'} disabled={savingDraft} variant="gold" onPress={() => void persistDraft(true)} /><Button title="Save for later" disabled={savingDraft} variant="secondary" onPress={() => void persistDraft()} /></>}
      <Button title="Contact us about next steps" disabled={savingDraft} variant="secondary" onPress={onContact} />
      <Button title="Back to this form" disabled={savingDraft} variant="quiet" onPress={() => setRoute('detail')} />
      <Text style={styles.footnote}>A preparation draft is not a completed USCIS form. Only saved answers remain after closing the app; deleting app or browser data removes local drafts.</Text>
    </>;
  }

  function attorneyIntake() {
    const updateLawyer = (key: keyof typeof lawyer, value: string) => {
      requestIdentity.reset();
      setLawyer(previous => ({ ...previous, [key]: value }));
    };
    return <><Badge>{form.id} · ATTORNEY ASSISTANCE</Badge><SectionTitle title="Tell us how we can help" subtitle="Prepare a request for individual guidance on your application." /><Card><View style={styles.metaRow}><Text style={styles.label}>Service price</Text><Text style={styles.compactPrice}>{money(attorney?.servicePriceUsd)}</Text></View><Text style={styles.small}>{attorney?.benchmark?.scope || 'Scope and price will need confirmation.'}</Text><Text style={styles.footnote}>Government fees and taxes are separate.</Text></Card>
      <Field label="Your full name" value={lawyer.name} onChangeText={name => updateLawyer('name', name)} autoComplete="name" maxLength={150} error={lawyerErrors.name} />
      <Field label="Email address" value={lawyer.email} onChangeText={email => updateLawyer('email', email)} autoComplete="email" autoCapitalize="none" keyboardType="email-address" maxLength={254} error={lawyerErrors.email} />
      <Field label="Phone number · optional" value={lawyer.phone} onChangeText={phone => updateLawyer('phone', phone)} autoComplete="tel" keyboardType="phone-pad" maxLength={40} error={lawyerErrors.phone} />
      <Field label="What would you like help with?" help="A brief description is enough. Avoid identity numbers or sensitive document details." value={lawyer.note} onChangeText={note => updateLawyer('note', note)} multiline maxLength={2000} error={lawyerErrors.note} />
      <Button title="Preview my request" icon="arrow-forward" onPress={previewAttorney} /><Notice>This preview does not send your request, book an attorney, charge a fee or establish an attorney-client relationship.</Notice>
    </>;
  }

  function attorneyPreview() {
    return <><Badge>{form.id} · {requestReceipt ? 'REQUEST SAVED' : 'REQUEST PREVIEW'}</Badge>
      <SectionTitle title={requestReceipt ? requestReceipt.delivery === 'team-inbox' ? 'Your request has been received' : 'Your request is saved locally' : 'Your request is ready to review'} subtitle={requestReceipt ? requestReceipt.delivery === 'team-inbox' ? 'Your details are saved in the FILLOUT team inbox.' : 'Your request is in the local inbox on this computer.' : 'Review your details before sending your request.'} />
      {!!requestReceipt && <Notice tone="success" title={requestReceipt.delivery === 'team-inbox' ? 'Request receipt' : 'Local receipt'}><Text selectable style={styles.small}>Reference: {requestReceipt.id}</Text><Text style={styles.small}>No payment was collected and no email notification was sent. An attorney has not been booked or assigned.</Text></Notice>}
      <Card><Text style={styles.cardTitle}>{lawyer.name}</Text><Text style={styles.body}>{lawyer.email}</Text>{!!lawyer.phone && <Text style={styles.body}>{lawyer.phone}</Text>}<View style={styles.divider} /><Text style={styles.label}>{form.id} · {form.title}</Text><Text style={styles.body}>{lawyer.note}</Text><View style={styles.metaRow}><Text style={styles.small}>Service price</Text><Text style={styles.compactPrice}>{money(attorney?.servicePriceUsd)}</Text></View></Card>
      {!!requestError && <Text accessibilityRole="alert" style={styles.error}>{requestError}</Text>}
      {!requestReceipt && <>
        {delivery.cloud && <EmailAccess initialEmail={lawyer.email} disabled={sendingRequest} />}
        {delivery.available && <>
          <Notice>{delivery.cloud ? 'By choosing Send request, you agree to share your contact details, selected form and question shown above with the FILLOUT team, stored in our online inbox. This does not book an attorney, take payment or send an email notification.' : 'By choosing Send request, you save your contact details, selected form and question in the local team inbox on this Mac.'}</Notice>
          <Button title={sendingRequest ? 'Saving request…' : 'Send request'} disabled={sendingRequest || !delivery.canSubmit} icon="send-outline" onPress={() => void sendAttorneyRequest()} />
        </>}
        <Button title="Edit my request" disabled={sendingRequest} variant="secondary" icon="create-outline" onPress={() => setRoute('attorney')} />
      </>}
      <Button title="Contact us" disabled={sendingRequest} variant="secondary" onPress={onContact} />
      <Text style={styles.footnote}>{delivery.error || (delivery.checking ? 'Checking request delivery…' : delivery.cloud ? 'You remain in control: nothing is submitted until you choose Send request.' : delivery.available ? 'Send request saves your details to the inbox on this computer. It does not email a lawyer, schedule a consultation or collect payment.' : 'Request preview only. Sending is available from the locally hosted website; external delivery and scheduling are not connected.')}</Text>
    </>;
  }

  const pickerOptions: { id: string; label: string }[] = picker === 'status' ? finder.statuses : selectedStatus?.goals || [];
  const backLabels: Partial<Record<Route, string>> = { catalog: 'Home', finder: 'Home', detail: 'Forms', check: questionIndex ? 'Previous question' : 'Preparation options', result: 'Change last answer', aiIntro: 'Form check', interview: editingDraft ? 'Review answers' : fieldIndex ? 'Previous question' : 'Overview', interviewReview: 'Overview', attorney: 'Form check', attorneyPreview: 'Edit request' };
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.scrollContent}>
      <View style={styles.content}>
        {route !== 'home' && <Pressable accessibilityRole="button" accessibilityLabel={backLabels[route] || 'Back'} accessibilityState={{ disabled: loadingDraft || savingDraft || sendingRequest }} disabled={loadingDraft || savingDraft || sendingRequest} onPress={goBack} style={styles.back}><Ionicons name="arrow-back" size={21} color={colors.navy} /><Text style={styles.backText}>{backLabels[route] || 'Back'}</Text></Pressable>}
        {!!draftError && <Text accessibilityRole="alert" style={styles.error}>{draftError}</Text>}
        {!!draftMessage && (route === 'interview' || route === 'interviewReview' || route === 'aiIntro') && <Notice tone="success">{draftMessage}</Notice>}
        {loadingDraft ? <Notice title="Opening your saved draft">Checking your saved answers against the current questions…</Notice> : <>
        {route === 'home' && home()}
        {route === 'catalog' && catalog()}
        {route === 'finder' && <><SectionTitle eyebrow="A GOOD PLACE TO START" title="Find your form" subtitle="Choose the situation that applies to you." />{finderCard()}<Button title="Browse all forms" variant="secondary" onPress={() => setRoute('catalog')} /></>}
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
      <View style={styles.modalOverlay}><Pressable accessibilityLabel="Close guarantee terms" accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={() => setGuaranteeOpen(false)} />
        <View style={styles.modalSheet} accessibilityViewIsModal>
          <View style={styles.metaRow}><Text accessibilityRole="header" style={styles.cardTitle}>Preparation guarantee</Text><Pressable accessibilityRole="button" accessibilityLabel="Close guarantee terms" onPress={() => setGuaranteeOpen(false)} style={{ padding: 10 }}><Ionicons name="close" size={25} color={colors.navy} /></Pressable></View>
          <ScrollView contentContainerStyle={{ gap: 16, paddingTop: 12, paddingBottom: 28 }}>
            <Text style={styles.body}>Our planned guarantee covers a refund of the FILLOUT preparation fee if our preparation error causes a rejection. It is not a promise of USCIS approval.</Text>
            <Notice title="Paid services are not live yet">The complete refund conditions and claim process will be provided before paid preparation becomes available. No payment is collected in this preview.</Notice>
            <Text style={styles.small}>Government filing fees are separate. Please review the current USCIS instructions and your completed form before you file.</Text>
            <Button title="Contact us about the guarantee" icon="chatbubble-ellipses-outline" onPress={() => { setGuaranteeOpen(false); onContact(); }} />
            <Button title="Done" variant="secondary" onPress={() => setGuaranteeOpen(false)} />
          </ScrollView>
        </View>
      </View>
    </Modal>
    <Modal visible={picker !== null} animationType="slide" transparent onRequestClose={() => setPicker(null)}>
      <View style={styles.modalOverlay}><Pressable accessibilityLabel="Close choices" accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
        <View style={styles.modalSheet} accessibilityViewIsModal>
          <View style={styles.metaRow}><Text accessibilityRole="header" style={styles.cardTitle}>{picker === 'status' ? 'I am…' : 'I would like to…'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close choices" onPress={() => setPicker(null)} style={{ padding: 10 }}><Ionicons name="close" size={25} color={colors.navy} /></Pressable></View>
          <ScrollView contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">{pickerOptions.map(item => {
            const selected = (picker === 'status' ? statusId : goalId) === item.id;
            return <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => { if (picker === 'status') { setStatusId(item.id); setGoalId(''); } else setGoalId(item.id); setFinderMatchesVisible(false); setPicker(null); }} style={[styles.optionRow, selected && { backgroundColor: colors.goldLight }]}><Text style={[styles.body, { flex: 1, color: colors.navy }]}>{item.label}</Text><Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? colors.navy : colors.muted} /></Pressable>;
          })}</ScrollView>
        </View>
      </View>
    </Modal>
  </KeyboardAvoidingView>;
}

export default FormsFlow;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, padding: 20, paddingBottom: 36, alignItems: 'center' },
  content: { width: '100%', maxWidth: 680, gap: 22 },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 4 },
  contactIcon: { width: 44, height: 44, flexShrink: 0, borderRadius: 22, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  hero: { backgroundColor: '#052A58', borderRadius: radius.lg, padding: 22, gap: 20, overflow: 'hidden' },
  backgroundImage: { borderRadius: radius.lg, width: '100%', height: '100%' },
  heroEyebrow: { color: '#F3D783', fontSize: 10, lineHeight: 17, fontWeight: '800', letterSpacing: 1.8 },
  heroTitle: { color: colors.paper, fontWeight: '800', fontSize: 35, lineHeight: 42, letterSpacing: -0.8 },
  heroCopy: { color: '#D2E0F3', fontSize: 16, lineHeight: 25 },
  heroTerms: { color: '#D2E0F3', fontSize: 10, lineHeight: 16, textDecorationLine: 'underline' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { color: colors.navy, fontSize: 20, fontWeight: '800', lineHeight: 27, flexShrink: 1 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  small: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  label: { color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  link: { color: colors.navy, fontSize: 13, fontWeight: '700', padding: 8 },
  eyebrow: { color: '#8E6E2B', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  finderCard: { padding: 18, gap: 20, borderRadius: 24, boxShadow: '0px 5px 18px rgba(7, 45, 96, 0.05)' },
  finderIcon: { width: 48, height: 52, backgroundColor: colors.blueLight, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  finderFields: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  selectorField: { flex: 1, minWidth: 0, gap: 8 },
  selectorLabel: { color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  selector: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 11, minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FBFCFF' },
  selectorValue: { color: colors.text, fontSize: 12, lineHeight: 18, flex: 1 },
  pricedFormRow: { padding: 14, gap: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 23, backgroundColor: colors.paper, boxShadow: '0px 4px 14px rgba(7, 45, 96, 0.035)' },
  formInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  formCodeBadge: { backgroundColor: '#E5F0FF', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 11, minWidth: 64, alignItems: 'center' },
  formCode: { color: colors.navy, fontSize: 17, fontWeight: '800', lineHeight: 23 },
  formSummary: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  priceColumns: { flexDirection: 'row', gap: 7, alignItems: 'stretch' },
  priceColumn: { flex: 1, minWidth: 0, gap: 5, borderWidth: 1, borderColor: colors.blueBorder, backgroundColor: colors.blueLight, borderRadius: 13, paddingVertical: 12, paddingHorizontal: 4, alignItems: 'center' },
  attorneyPriceColumn: { borderColor: '#F0DFB7', backgroundColor: colors.cream },
  priceLabel: { color: '#405578', fontSize: 10, lineHeight: 15, minHeight: 30, textAlign: 'center' },
  listPrice: { color: colors.navy, fontSize: 20, fontWeight: '800', lineHeight: 26, textAlign: 'center' },
  priceNote: { color: colors.muted, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  priceGuarantee: { paddingVertical: 5, minHeight: 34, justifyContent: 'center' },
  priceGuaranteeText: { color: '#1469AB', fontSize: 10, lineHeight: 14, fontWeight: '600', textAlign: 'center' },
  otherFormsHeader: { minHeight: 76, padding: 17, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.paper },
  confidencePoints: { flexDirection: 'row', alignItems: 'stretch', marginTop: 3 },
  confidencePoint: { flex: 1, minWidth: 0, alignItems: 'center', gap: 8, paddingHorizontal: 5 },
  confidencePointBorder: { borderLeftWidth: 1, borderLeftColor: 'rgba(189, 215, 246, 0.25)' },
  confidencePointText: { color: '#F0F5FF', fontSize: 11, lineHeight: 16, textAlign: 'center' },
  confidenceBanner: { padding: 20, backgroundColor: '#052A58', borderRadius: radius.lg, overflow: 'hidden', gap: 23 },
  confidenceBannerTop: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  guaranteeBadge: { aspectRatio: 1, alignSelf: 'center' },
  confidenceTitle: { color: colors.paper, fontSize: 24, lineHeight: 29, fontWeight: '800', letterSpacing: -0.45 },
  confidenceCopy: { color: '#D2E0F3', fontSize: 13, lineHeight: 20 },
  guaranteeLink: { flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', minHeight: 34 },
  guaranteeLinkText: { color: '#F3D783', fontSize: 11, lineHeight: 17, textAlign: 'center', textDecorationLine: 'underline', flexShrink: 1 },
  whyCard: { padding: 22, gap: 20, borderRadius: 24 },
  whyTitle: { color: colors.navy, fontSize: 30, lineHeight: 37, fontWeight: '800', letterSpacing: -0.7 },
  goldLine: { height: 4, width: 100, backgroundColor: colors.gold, borderRadius: 3 },
  reasonCards: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  reasonCard: { flex: 1, gap: 8, paddingVertical: 18, paddingHorizontal: 12, borderRadius: 18, alignItems: 'center' },
  reasonTitle: { color: colors.navy, fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  reasonCopy: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  homeFooter: { paddingTop: 10, gap: 18, borderTopWidth: 1, borderTopColor: colors.border },
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
