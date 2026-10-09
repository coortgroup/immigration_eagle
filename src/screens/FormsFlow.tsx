import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, BackHandler, KeyboardAvoidingView, Linking, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Badge, BrandMark, Button, Card, Field, Notice, RowLink, SectionTitle } from '../components/UI';
import { colors, radius } from '../theme';
import { evaluateQualification, validateField } from '../qualification';
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
type Props = { onContact: () => void; onDraftSaved?: (draft: DraftSummary) => void; isActive?: boolean };

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

export function FormsFlow({ onContact, onDraftSaved, isActive = true }: Props) {
  const [route, setRoute] = useState<Route>('home');
  const [returnTo, setReturnTo] = useState<Route>('catalog');
  const [formId, setFormId] = useState('N-400');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [otherFormsOpen, setOtherFormsOpen] = useState(false);
  const [statusId, setStatusId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [picker, setPicker] = useState<PickerKind>(null);
  const [mode, setMode] = useState<PreparationMode>('self');
  const [answers, setAnswers] = useState<Record<string, QualificationAnswer>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [showCheckAnswers, setShowCheckAnswers] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [fieldIndex, setFieldIndex] = useState(0);
  const [fieldError, setFieldError] = useState('');
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftFinished, setDraftFinished] = useState(false);
  const [lawyer, setLawyer] = useState({ name: '', email: '', phone: '', note: '' });
  const [lawyerErrors, setLawyerErrors] = useState<Record<string, string>>({});
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
  const selectedStatus = finder.statuses.find((item: any) => item.id === statusId);
  const selectedGoal = selectedStatus?.goals.find((item: any) => item.id === goalId);
  const visibleForms = useMemo(() => forms.filter(item => {
    const query = search.trim().toLowerCase();
    return (category === 'All' || item.category === category) && (!query || `${item.id} ${item.title} ${item.summary} ${item.category}`.toLowerCase().includes(query));
  }), [search, category]);

  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [route, formId, questionIndex, fieldIndex]);

  function openForm(id: string, origin: Route = route) {
    setFormId(id); setReturnTo(origin === 'detail' ? 'catalog' : origin); setRoute('detail');
    setAnswers({}); setQuestionIndex(0); setShowCheckAnswers(false); setFieldError('');
  }

  function editCheck(index: number) {
    const previous: Record<string, QualificationAnswer> = {};
    schema?.questions.slice(0, index).forEach(item => { if (answers[item.id]) previous[item.id] = answers[item.id]; });
    setAnswers(previous); setQuestionIndex(index); setRoute('check');
  }

  function goBack() {
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
  }, [isActive, route, questionIndex, fieldIndex, editingDraft, returnTo, qualification.index, answers]);

  function startCheck(selectedMode: PreparationMode) {
    setMode(selectedMode); setAnswers({}); setQuestionIndex(0); setShowCheckAnswers(false);
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

  function finishDraft() {
    const invalid = fields.findIndex(item => validateField(item, draft[item.id] || '') !== null);
    if (invalid >= 0) { setFieldIndex(invalid); setFieldError('Please complete this answer.'); setEditingDraft(true); setRoute('interview'); return; }
    setDraftFinished(true);
    onDraftSaved?.({ formId: form.id, title: form.title, answered: fields.length, total: fields.length, updatedAt: new Date().toISOString() });
  }

  function previewAttorney() {
    const errors: Record<string, string> = {};
    if (!lawyer.name.trim()) errors.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lawyer.email.trim())) errors.email = 'Enter a valid email address.';
    if (lawyer.phone && lawyer.phone.replace(/\D/g, '').length < 7) errors.phone = 'Enter a valid phone number, or leave this blank.';
    if (!lawyer.note.trim()) errors.note = 'Briefly describe the help you need.';
    setLawyerErrors(errors);
    if (!Object.keys(errors).length) setRoute('attorneyPreview');
  }

  function formPriceSummary(item: FormRecord) {
    const ai = aiOffer(item.id);
    const reference = pricing.forms.find((entry: any) => entry.id === item.id).citizenPath;
    const lawyerPrice = attorneys.forms.find((entry: any) => entry.id === item.id)?.servicePriceUsd;
    const detail = reference.status === 'included' || reference.status === 'add-on' ? ai.note : item.id === 'I-485' ? 'Base package' : item.id === 'I-821D' ? 'Includes I-765 and I-765WS' : '';
    return <View style={styles.priceColumns}>
      <View style={styles.priceColumn}><Text style={styles.priceLabel}>Do it yourself</Text><Text style={styles.listPrice}>Free</Text></View>
      <View style={styles.priceColumn}><Text style={styles.priceLabel}>With AI</Text><Text style={styles.listPrice}>{ai.unavailable ? 'Contact us' : ai.price}</Text>{!!detail && <Text style={styles.priceNote}>{detail}</Text>}</View>
      <View style={styles.priceColumn}><Text style={styles.priceLabel}>With an attorney</Text><Text style={styles.listPrice}>{typeof lawyerPrice === 'number' ? money(lawyerPrice) : 'Get a quote'}</Text>{typeof lawyerPrice === 'number' && !!attorneyScope[item.id] && <Text style={styles.priceNote}>{attorneyScope[item.id]}</Text>}</View>
    </View>;
  }

  function pricedFormRow(item: FormRecord, shortTitle: boolean) {
    return <View key={item.id} style={styles.pricedFormRow}>
      <View style={styles.formInfo}><Badge>{item.id}</Badge><Text style={[styles.rowTitle, { flex: 1 }]}>{shortTitle ? formLabels[item.id] || item.title : item.title}</Text></View>
      {formPriceSummary(item)}
      <Button title="Start filling out form" accessibilityLabel={`Start filling out form ${item.id}`} variant="quiet" icon="arrow-forward" onPress={() => openForm(item.id)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0, minHeight: 44 }} />
    </View>;
  }

  function formRow(item: FormRecord) {
    return pricedFormRow(item, false);
  }

  function homeForms() {
    const mainForms = mainFormIds.map(id => forms.find(item => item.id === id)).filter((item): item is FormRecord => !!item);
    const otherForms = forms.filter(item => !mainFormIds.includes(item.id));
    return <View style={{ gap: 17 }}>
      <SectionTitle title="Immigration forms" subtitle="Self-preparation is free. Choose AI or attorney assistance below." />
      <Text accessibilityRole="header" style={styles.label}>Main forms</Text>
      <Card style={{ paddingVertical: 0 }}>{mainForms.map(item => pricedFormRow(item, true))}</Card>
      <Card style={{ paddingVertical: 0 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`All other forms, ${otherForms.length} documents`} accessibilityState={{ expanded: otherFormsOpen }} onPress={() => setOtherFormsOpen(!otherFormsOpen)} style={styles.otherFormsHeader}>
          <Text style={[styles.label, { flex: 1 }]}>All other forms</Text><Badge>{otherForms.length}</Badge><Ionicons name={otherFormsOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.navy} />
        </Pressable>
        {otherFormsOpen && otherForms.map(item => pricedFormRow(item, true))}
      </Card>
      <Text style={styles.footnote}>Prices in USD. Government filing fees and taxes are separate.</Text>
    </View>;
  }

  function selector(kind: 'status' | 'goal', label: string, value: string | undefined, placeholder: string) {
    const disabled = kind === 'goal' && !selectedStatus;
    return <View style={{ gap: 8 }}><Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${value || placeholder}`} accessibilityState={{ disabled }} disabled={disabled} onPress={() => setPicker(kind)} style={[styles.selector, disabled && { opacity: 0.5 }]}>
        <Text style={[styles.selectorValue, !value && { color: colors.muted }]}>{value || placeholder}</Text><Ionicons name="chevron-down" size={18} color={colors.navy} />
      </Pressable>
    </View>;
  }

  function finderCard() {
    return <Card>
      <View style={styles.sectionHeading}><View style={styles.fileIcon}><Ionicons name="search-outline" color={colors.navy} size={24} /></View><Text accessibilityRole="header" style={styles.cardTitle}>Find the right USCIS form</Text></View>
      <Text style={styles.body}>Tell us about your situation to explore the right document.</Text>
      {selector('status', 'I am', selectedStatus?.label, 'Choose your current status')}
      {selector('goal', 'I would like to', selectedGoal?.label, 'Choose what you want to do')}
      {!!selectedGoal && <View style={{ gap: 5 }}><Text style={styles.eyebrow}>YOUR MATCH</Text>{selectedGoal.forms.map((id: string) => forms.find(item => item.id === id)).filter(Boolean).map(formRow)}<Text style={styles.small}>A form match is a starting point. A short check follows before preparation.</Text></View>}
      {!!statusId && <Button title="Reset choices" variant="quiet" onPress={() => { setStatusId(''); setGoalId(''); }} />}
    </Card>;
  }

  function home() {
    const benefits: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
      { icon: 'shield-checkmark-outline', title: 'Attorney-Reviewed Software', text: "Prepare USCIS forms correctly with easy, step-by-step process and alerts if there's a problem" },
      { icon: 'document-text-outline', title: 'Official USCIS Forms', text: 'Perfectly prepared documents on the latest edition of USCIS forms' },
      { icon: 'list-outline', title: 'Personal Filing Instructions', text: 'Checklist of supporting documents and how to organize your application' },
      { icon: 'print-outline', title: 'Printing & Shipping', text: 'Digital download on all orders and optional print and mail available' },
      { icon: 'documents-outline', title: 'Sample Documents', text: 'Example cover letters, affidavits and how-to information for your situation' },
      { icon: 'chatbubbles-outline', title: 'Customer Support', text: 'Live, knowledgeable customer support at your fingertips' },
    ];
    return <>
      <View style={styles.topLine}><BrandMark /><Pressable accessibilityRole="button" accessibilityLabel="Contact our team" onPress={onContact} style={styles.contactIcon}><Ionicons name="chatbubble-ellipses-outline" size={23} color={colors.navy} /></Pressable></View>
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>IMMIGRATION MADE SIMPLE</Text>
        <Text accessibilityRole="header" style={styles.heroTitle}>Prepare immigration paperwork correctly, <Text style={{ color: colors.gold }}>guaranteed.</Text></Text>
        <Text style={styles.heroCopy}>Find your form. Follow clear steps.{'\n'}Move forward with confidence.</Text>
      </View>
      {finderCard()}
      {homeForms()}
      <SectionTitle eyebrow="SUPPORT AT EVERY STEP" title="Every package includes" />
      <Card style={{ gap: 24 }}>{benefits.map(item => <View key={item.title} style={{ flexDirection: 'row', gap: 14 }}><View style={styles.benefitIcon}><Ionicons name={item.icon} size={21} color={colors.navy} /></View><View style={{ flex: 1, gap: 5 }}><Text style={styles.label}>{item.title}</Text><Text style={styles.small}>{item.text}</Text></View></View>)}</Card>
      <Text style={styles.footnote}>Native app preview · Payments, live AI, filing and shipping are not connected.</Text>
    </>;
  }

  function catalog() {
    return <><SectionTitle eyebrow="YOUR DOCUMENTS, ONE PLACE" title="Find your next step" subtitle="Explore all 21 forms and supporting documents." />
      <Field label="Search forms" placeholder="Try N-400, citizenship or work permit" value={search} onChangeText={setSearch} autoCorrect={false} clearButtonMode="while-editing" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>{categories.map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: item === category }} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipSelected]}><Text style={[styles.chipText, category === item && { color: colors.paper }]}>{item}</Text></Pressable>)}</ScrollView>
      <Button title="Help me choose a form" variant="secondary" icon="search-outline" onPress={() => setRoute('finder')} />
      <Text accessibilityLiveRegion="polite" style={styles.small}>{visibleForms.length} {visibleForms.length === 1 ? 'document' : 'documents'}</Text>
      {visibleForms.length ? <Card style={{ paddingVertical: 2 }}>{visibleForms.map(formRow)}</Card> : <Notice title="No forms found">Try a form number or a broader search, such as family or travel.</Notice>}
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
    const completed = fields.filter(item => draft[item.id]?.trim()).length;
    return <><Badge gold>{form.id} · GUIDED PREPARATION</Badge><SectionTitle title="One question at a time" subtitle="Build a clear draft of your information before completing your application." /><Card><View style={styles.sectionHeading}><BrandMark compact /><View style={{ flex: 1 }}><Text style={styles.cardTitle}>Eagle preparation</Text><Text style={styles.small}>{interview?.subject}</Text></View></View><View style={styles.metaRow}><Text style={styles.body}>{fields.length} starting questions</Text><Text style={styles.label}>{offer.price}</Text></View><Text style={styles.small}>{completed ? `${completed} answers saved for this session.` : 'You can review and edit every answer.'}</Text><Button title={completed ? 'Continue my draft' : 'Start the questions'} variant="gold" icon="arrow-forward" onPress={() => { const missing = fields.findIndex(item => !draft[item.id]?.trim()); setFieldIndex(missing < 0 ? 0 : missing); setEditingDraft(false); setFieldError(''); setDraftFinished(false); setRoute(missing < 0 && completed ? 'interviewReview' : 'interview'); }} /></Card><Notice title="About this preview">This is a guided intake, not a live AI conversation. Your answers stay in this app session. Nothing is sent, charged or filed, and the draft does not generate a completed USCIS form.</Notice></>;
  }

  function interviewScreen() {
    if (!field) return <Notice title="Draft unavailable">Contact our team for help with this document.</Notice>;
    const inputType = field.type;
    return <><Badge gold>{form.id} · PREPARATION DRAFT</Badge><View style={styles.metaRow}><Text style={styles.small}>{editingDraft ? 'Edit your answer' : `Question ${fieldIndex + 1} of ${fields.length}`}</Text><Text style={styles.small}>Session only</Text></View><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${(fieldIndex + 1) / fields.length * 100}%` }]} /></View><SectionTitle title={field.label} />
      <Field label={inputType === 'date' ? 'Date · MM/DD/YYYY' : 'Your answer'} help={field.help} value={draft[field.id] || ''} onChangeText={value => { setDrafts(previous => ({ ...previous, [form.id]: { ...(previous[form.id] || {}), [field.id]: value } })); if (fieldError) setFieldError(''); setDraftFinished(false); }}
        placeholder={inputType === 'date' ? 'MM/DD/YYYY' : inputType === 'email' ? 'name@example.com' : inputType === 'tel' ? '+1 (555) 000-0000' : 'Enter your answer'}
        multiline={inputType === 'textarea'} autoCapitalize={inputType === 'email' ? 'none' : 'sentences'} keyboardType={inputType === 'email' ? 'email-address' : inputType === 'tel' ? 'phone-pad' : inputType === 'date' ? 'numbers-and-punctuation' : 'default'}
        maxLength={inputType === 'textarea' ? 2000 : inputType === 'date' ? 10 : 300} error={fieldError} />
      <Button title={editingDraft ? 'Save answer' : fieldIndex === fields.length - 1 ? 'Review my answers' : 'Next question'} variant="gold" icon="arrow-forward" onPress={saveField} /><Text style={styles.footnote}>Enter accurate information. If a question does not fit your situation, contact our team for help.</Text>
    </>;
  }

  function interviewReview() {
    return <><Badge gold>{form.id} · PREPARATION DRAFT</Badge><SectionTitle title={draftFinished ? 'Your draft is ready to revisit' : 'Review your answers'} subtitle="Tap an answer to make a correction." />
      {draftFinished && <Notice tone="success" title="Draft reviewed">Your answers remain available during this app session. No application has been generated or filed.</Notice>}
      <Card style={{ paddingVertical: 3 }}>{fields.map((item, index) => <RowLink key={item.id} title={item.label} subtitle={draft[item.id] || 'Not answered'} onPress={() => { setFieldIndex(index); setEditingDraft(true); setFieldError(''); setDraftFinished(false); setRoute('interview'); }} icon="create-outline" />)}</Card>
      {!draftFinished && <Button title="Finish reviewing my draft" variant="gold" onPress={finishDraft} />}
      <Button title="Contact us about next steps" variant="secondary" onPress={onContact} />
      <Button title="Back to this form" variant="quiet" onPress={() => setRoute('detail')} />
      <Text style={styles.footnote}>A preparation draft is not a completed USCIS form. Closing or reloading the app can clear this session.</Text>
    </>;
  }

  function attorneyIntake() {
    return <><Badge>{form.id} · ATTORNEY ASSISTANCE</Badge><SectionTitle title="Tell us how we can help" subtitle="Prepare a request for individual guidance on your application." /><Card><View style={styles.metaRow}><Text style={styles.label}>Service price</Text><Text style={styles.compactPrice}>{money(attorney?.servicePriceUsd)}</Text></View><Text style={styles.small}>{attorney?.benchmark?.scope || 'Scope and price will need confirmation.'}</Text><Text style={styles.footnote}>Government fees and taxes are separate.</Text></Card>
      <Field label="Your full name" value={lawyer.name} onChangeText={name => setLawyer(previous => ({ ...previous, name }))} autoComplete="name" maxLength={150} error={lawyerErrors.name} />
      <Field label="Email address" value={lawyer.email} onChangeText={email => setLawyer(previous => ({ ...previous, email }))} autoComplete="email" autoCapitalize="none" keyboardType="email-address" maxLength={254} error={lawyerErrors.email} />
      <Field label="Phone number · optional" value={lawyer.phone} onChangeText={phone => setLawyer(previous => ({ ...previous, phone }))} autoComplete="tel" keyboardType="phone-pad" maxLength={40} error={lawyerErrors.phone} />
      <Field label="What would you like help with?" help="A brief description is enough. Avoid identity numbers or sensitive document details." value={lawyer.note} onChangeText={note => setLawyer(previous => ({ ...previous, note }))} multiline maxLength={2000} error={lawyerErrors.note} />
      <Button title="Preview my request" icon="arrow-forward" onPress={previewAttorney} /><Notice>This preview does not send your request, book an attorney, charge a fee or establish an attorney-client relationship.</Notice>
    </>;
  }

  function attorneyPreview() {
    return <><Badge>{form.id} · REQUEST PREVIEW</Badge><SectionTitle title="Your request is ready to review" subtitle="Nothing has been sent. Confirm your details before using a connected support channel." /><Card><Text style={styles.cardTitle}>{lawyer.name}</Text><Text style={styles.body}>{lawyer.email}</Text>{!!lawyer.phone && <Text style={styles.body}>{lawyer.phone}</Text>}<View style={styles.divider} /><Text style={styles.label}>{form.id} · {form.title}</Text><Text style={styles.body}>{lawyer.note}</Text><View style={styles.metaRow}><Text style={styles.small}>Service price</Text><Text style={styles.compactPrice}>{money(attorney?.servicePriceUsd)}</Text></View></Card><Button title="Edit my request" variant="secondary" icon="create-outline" onPress={() => setRoute('attorney')} /><Button title="Contact us" onPress={onContact} /><Text style={styles.footnote}>Request preview only · Sending and scheduling are not connected.</Text></>;
  }

  const pickerOptions: { id: string; label: string }[] = picker === 'status' ? finder.statuses : selectedStatus?.goals || [];
  const backLabels: Partial<Record<Route, string>> = { catalog: 'Home', finder: 'Home', detail: 'Forms', check: questionIndex ? 'Previous question' : 'Preparation options', result: 'Change last answer', aiIntro: 'Form check', interview: editingDraft ? 'Review answers' : fieldIndex ? 'Previous question' : 'Overview', interviewReview: 'Overview', attorney: 'Form check', attorneyPreview: 'Edit request' };
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.scrollContent}>
      <View style={styles.content}>
        {route !== 'home' && <Pressable accessibilityRole="button" accessibilityLabel={backLabels[route] || 'Back'} onPress={goBack} style={styles.back}><Ionicons name="arrow-back" size={21} color={colors.navy} /><Text style={styles.backText}>{backLabels[route] || 'Back'}</Text></Pressable>}
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
      </View>
    </ScrollView>
    <Modal visible={picker !== null} animationType="slide" transparent onRequestClose={() => setPicker(null)}>
      <View style={styles.modalOverlay}><Pressable accessibilityLabel="Close choices" accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
        <View style={styles.modalSheet} accessibilityViewIsModal>
          <View style={styles.metaRow}><Text accessibilityRole="header" style={styles.cardTitle}>{picker === 'status' ? 'I am…' : 'I would like to…'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close choices" onPress={() => setPicker(null)} style={{ padding: 10 }}><Ionicons name="close" size={25} color={colors.navy} /></Pressable></View>
          <ScrollView contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">{pickerOptions.map(item => {
            const selected = (picker === 'status' ? statusId : goalId) === item.id;
            return <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => { if (picker === 'status') { setStatusId(item.id); setGoalId(''); } else setGoalId(item.id); setPicker(null); }} style={[styles.optionRow, selected && { backgroundColor: colors.goldLight }]}><Text style={[styles.body, { flex: 1, color: colors.navy }]}>{item.label}</Text><Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? colors.navy : colors.muted} /></Pressable>;
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
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  contactIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  hero: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 25, gap: 20 },
  heroEyebrow: { color: colors.gold, fontSize: 10, lineHeight: 17, fontWeight: '800', letterSpacing: 1.5 },
  heroTitle: { color: colors.paper, fontWeight: '800', fontSize: 33, lineHeight: 41, letterSpacing: -0.8 },
  heroCopy: { color: '#CFD8E6', fontSize: 16, lineHeight: 24 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { color: colors.navy, fontSize: 20, fontWeight: '800', lineHeight: 27, flexShrink: 1 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  small: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  label: { color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  link: { color: colors.navy, fontSize: 13, fontWeight: '700', padding: 8 },
  eyebrow: { color: '#8E6E2B', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  selector: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 15, minHeight: 55, flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectorValue: { color: colors.text, fontSize: 15, lineHeight: 22, flex: 1 },
  pricedFormRow: { paddingTop: 18, paddingBottom: 10, gap: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  formInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  priceColumns: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  priceColumn: { flex: 1, minWidth: 0, gap: 4 },
  priceLabel: { color: colors.muted, fontSize: 11, lineHeight: 16, minHeight: 32 },
  listPrice: { color: colors.navy, fontSize: 16, fontWeight: '700', lineHeight: 22 },
  priceNote: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  otherFormsHeader: { minHeight: 62, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  fileIcon: { width: 43, height: 46, backgroundColor: '#EEF2F7', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  formId: { color: '#8E6E2B', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  rowTitle: { color: colors.navy, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  benefitIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: colors.goldLight, justifyContent: 'center', alignItems: 'center' },
  footnote: { color: colors.muted, fontSize: 12, lineHeight: 19 },
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
