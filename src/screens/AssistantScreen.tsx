import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { submitLocalRequest, useLocalDelivery } from '../localRequests';

export type AssistantScreenProps = {
  /** Increment to open Contact us, including when this screen is already mounted. */
  contactRequest?: number;
  /** Only the visible tab should consume the Android back button. */
  isActive?: boolean;
};

type ContactDraft = { name: string; email: string; phone: string; question: string };
type ContactField = keyof ContactDraft;
type ContactErrors = Partial<Record<ContactField, string>>;
type PromptId = 'forms' | 'documents' | 'next';
type ChatTurn = { id: number; question: string; answer: string };

const EMPTY_CONTACT: ContactDraft = { name: '', email: '', phone: '', question: '' };
const PROMPTS: { id: PromptId; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'forms', label: 'Help me choose a form', icon: 'list-outline' },
  { id: 'documents', label: 'Organize my documents', icon: 'documents-outline' },
  { id: 'next', label: 'What’s my next step?', icon: 'arrow-forward-outline' },
];
const DEMO_ANSWERS: Record<PromptId, string> = {
  forms: 'Start with the form finder on Home. Choose your current status and what you want to do, then read the form details and compare preparation options. A short form check helps identify questions that need individual review.',
  documents: 'Read the current USCIS instructions for your chosen form before gathering evidence. Make a list of the documents that apply to your situation. This demo does not accept or store document uploads.',
  next: 'Choose a form on Home and review its purpose and preparation options. If you are unsure which process fits your situation, open Contact us to draft a question for the team.',
};
const GENERAL_DEMO_ANSWER = 'This is a scripted demo, so I cannot assess your message or provide a personalized answer. Try a suggested question to explore the app, or open Contact us to preview a question for the team.';

function validateContact(draft: ContactDraft): ContactErrors {
  const errors: ContactErrors = {};
  if (!draft.name.trim()) errors.name = 'Enter your name.';
  const email = draft.email.trim();
  const phone = draft.phone.trim();
  if (!email && !phone) errors.email = 'Enter an email address or phone number.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (phone && (!/^\+?[\d\s().-]+$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15)) {
    errors.phone = 'Enter a valid phone number, including its country code if needed.';
  }
  if (!draft.question.trim()) errors.question = 'Enter your question.';
  return errors;
}

export function AssistantScreen({ contactRequest = 0, isActive = true }: AssistantScreenProps) {
  const [contactOpen, setContactOpen] = useState(false);
  const [draft, setDraft] = useState<ContactDraft>({ ...EMPTY_CONTACT });
  const [errors, setErrors] = useState<ContactErrors>({});
  const [preview, setPreview] = useState<ContactDraft | null>(null);
  const delivery = useLocalDelivery();
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState('');
  const [sendError, setSendError] = useState('');
  const submitting = useRef(false);
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const lastContactRequest = useRef(0);
  const turnId = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const nameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const questionRef = useRef<TextInput>(null);
  const shouldScrollChat = useRef(false);

  useEffect(() => {
    if (contactRequest > 0 && contactRequest !== lastContactRequest.current) {
      lastContactRequest.current = contactRequest;
      setPreview(null);
      setReceipt(''); setSendError('');
      setContactOpen(true);
      Keyboard.dismiss();
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [contactRequest]);

  useEffect(() => {
    if (!contactOpen || !isActive) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (submitting.current) return true;
      Keyboard.dismiss();
      if (preview) setPreview(null);
      else setContactOpen(false);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      return true;
    });
    return () => subscription.remove();
  }, [contactOpen, preview, isActive]);

  const openContact = () => {
    setPreview(null);
    setReceipt(''); setSendError('');
    setContactOpen(true);
    Keyboard.dismiss();
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const closeContact = () => {
    if (submitting.current) return;
    Keyboard.dismiss();
    setContactOpen(false);
    setPreview(null);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const updateDraft = (field: ContactField, value: string) => {
    setDraft(current => ({ ...current, [field]: value }));
    setErrors(current => ({ ...current, [field]: undefined, ...(field === 'phone' && !draft.email.trim() ? { email: undefined } : {}) }));
  };

  const previewContact = () => {
    const nextErrors = validateContact(draft);
    setErrors(nextErrors);
    const firstError = (['name', 'email', 'phone', 'question'] as ContactField[]).find(field => nextErrors[field]);
    if (firstError) {
      const inputRefs = { name: nameRef, email: emailRef, phone: phoneRef, question: questionRef };
      inputRefs[firstError].current?.focus();
      AccessibilityInfo.announceForAccessibility(nextErrors[firstError] ?? 'Check the form.');
      return;
    }
    Keyboard.dismiss();
    setReceipt(''); setSendError('');
    setPreview({ name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim(), question: draft.question.trim() });
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    AccessibilityInfo.announceForAccessibility('Request preview. No request has been sent.');
  };

  const addTurn = (question: string, promptId?: PromptId) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    const answer = promptId ? DEMO_ANSWERS[promptId] : GENERAL_DEMO_ANSWER;
    const id = ++turnId.current;
    shouldScrollChat.current = true;
    setTurns(current => [...current, { id, question: trimmed, answer }]);
    setMessage('');
    Keyboard.dismiss();
    AccessibilityInfo.announceForAccessibility(`Demo response. ${answer}`);
  };

  const backToForm = () => {
    if (submitting.current) return;
    setPreview(null);
    setReceipt(''); setSendError('');
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const sendContact = async () => {
    if (!preview || submitting.current || receipt || !delivery.available) return;
    submitting.current = true; setSending(true); setSendError('');
    try {
      const result = await submitLocalRequest({ type:'contact', ...preview });
      setReceipt(result.id);
      setDraft({ ...EMPTY_CONTACT });
      AccessibilityInfo.announceForAccessibility('Request saved to the local team inbox.');
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'The request could not be saved. Please try again.');
    } finally { submitting.current=false; setSending(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onContentSizeChange={() => {
          if (shouldScrollChat.current && !contactOpen) {
            shouldScrollChat.current = false;
            scrollRef.current?.scrollToEnd({ animated: true });
          }
        }}
      >
        {contactOpen ? (
          <>
            <Pressable accessibilityRole="button" onPress={preview ? backToForm : closeContact} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <Ionicons name="chevron-back" size={20} color="#092653" />
              <Text style={styles.textButton}>{preview ? 'Back to form' : 'Eagle AI'}</Text>
            </Pressable>
            <Text style={styles.eyebrow}>WE’RE HERE TO HELP</Text>
            <Text accessibilityRole="header" style={styles.title}>{receipt ? 'Request received locally' : preview ? 'Review your request' : 'Contact us'}</Text>
            <View style={styles.notice}>
              <Ionicons name="information-circle-outline" size={20} color="#092653" />
              <Text style={styles.noticeText}>{delivery.available ? 'Requests are saved to the team inbox on this Mac. No email, call or external notification is sent during local testing.' : 'Request delivery is not connected here. You can review your details without sending them.'}</Text>
            </View>

            {preview ? (
              <>
                <View style={styles.previewCard}>
                  <PreviewField label="Name" value={preview.name} />
                  {preview.email ? <PreviewField label="Email" value={preview.email} /> : null}
                  {preview.phone ? <PreviewField label="Phone" value={preview.phone} /> : null}
                  <PreviewField label="Question" value={preview.question} />
                </View>
                {!!receipt && <View style={styles.notice}><Text selectable style={styles.noticeText}>Saved to the local team inbox. Reference: {receipt}</Text></View>}
                {!!sendError && <Text accessibilityRole="alert" style={[styles.error,{marginBottom:14}]}>{sendError}</Text>}
                {delivery.available && !receipt && <Pressable accessibilityRole="button" disabled={sending} accessibilityState={{disabled:sending}} onPress={()=>void sendContact()} style={({pressed})=>[styles.primaryButton,{marginBottom:12},sending&&styles.disabled,pressed&&styles.pressed]}><Text style={styles.primaryButtonText}>{sending?'Sending…':'Send request to local team'}</Text><Ionicons name="send-outline" size={20} color="#092653"/></Pressable>}
                {!receipt && <Pressable accessibilityRole="button" disabled={sending} onPress={backToForm} style={({ pressed }) => [styles.primaryButton,sending&&styles.disabled, pressed && styles.pressed]}>
                  <Text style={styles.primaryButtonText}>Edit request</Text>
                  <Ionicons name="create-outline" size={20} color="#092653" />
                </Pressable>}
                {!!receipt && <Pressable accessibilityRole="button" onPress={closeContact} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Back to Eagle AI</Text></Pressable>}
                <Text style={styles.footnote}>{receipt ? 'This local receipt does not book an appointment or establish an attorney-client relationship.' : delivery.available ? 'Review your contact details before sending. Your question and contact details will be visible in the local team inbox.' : 'This is a request preview. Nothing has been submitted.'}</Text>
              </>
            ) : (
              <>
                <Text style={styles.intro}>Tell our team what you need and how you would like us to reach you. An email address or phone number is enough.</Text>
                <FieldLabel label="Your name" error={errors.name} />
                <TextInput ref={nameRef} accessibilityLabel="Your name, required" accessibilityHint={errors.name} style={[styles.input, errors.name && styles.invalidInput]} value={draft.name} onChangeText={value => updateDraft('name', value)} placeholder="Full name" placeholderTextColor="#738094" autoComplete="off" textContentType="none" autoCorrect={false} maxLength={100} returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} />

                <Text style={styles.contactHelp}>Email or phone number is required. You may enter both.</Text>
                <FieldLabel label="Email" error={errors.email} />
                <TextInput ref={emailRef} accessibilityLabel="Email" accessibilityHint={errors.email ?? 'Enter an email address or use the phone number field.'} style={[styles.input, errors.email && styles.invalidInput]} value={draft.email} onChangeText={value => updateDraft('email', value)} placeholder="you@example.com" placeholderTextColor="#738094" keyboardType="email-address" autoCapitalize="none" autoComplete="off" textContentType="none" autoCorrect={false} maxLength={150} returnKeyType="next" onSubmitEditing={() => phoneRef.current?.focus()} />

                <FieldLabel label="Phone number" error={errors.phone} />
                <TextInput ref={phoneRef} accessibilityLabel="Phone number" accessibilityHint={errors.phone ?? 'Enter a phone number or use the email field.'} style={[styles.input, errors.phone && styles.invalidInput]} value={draft.phone} onChangeText={value => updateDraft('phone', value)} placeholder="+1 (555) 123-4567" placeholderTextColor="#738094" keyboardType="phone-pad" autoComplete="off" textContentType="none" maxLength={40} />

                <FieldLabel label="Your question" error={errors.question} />
                <TextInput ref={questionRef} accessibilityLabel="Your question, required" accessibilityHint={errors.question} style={[styles.input, styles.questionInput, errors.question && styles.invalidInput]} value={draft.question} onChangeText={value => updateDraft('question', value)} placeholder="How can we help?" placeholderTextColor="#738094" multiline textAlignVertical="top" autoComplete="off" textContentType="none" maxLength={1500} />
                <Text style={styles.characterCount}>{draft.question.length}/1,500</Text>

                <Pressable accessibilityRole="button" accessibilityHint="Validates your details and shows a local preview. Does not send a request." onPress={previewContact} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                  <Text style={styles.primaryButtonText}>Review request</Text>
                  <Ionicons name="arrow-forward" size={20} color="#092653" />
                </Pressable>
                <Text style={styles.footnote}>Use sample details for local testing. Nothing is sent until you review and choose Send request.</Text>
              </>
            )}
          </>
        ) : (
          <>
            <View style={styles.header}>
              <View style={styles.brand}>
                <Text accessibilityRole="header" style={styles.aiTitle}>Eagle AI</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={openContact} style={({ pressed }) => [styles.contactButton, pressed && styles.pressed]}>
                <Text style={styles.contactButtonText}>Contact us</Text>
              </Pressable>
            </View>
            <View style={styles.demoBadge}>
              <View style={styles.demoDot} />
              <Text style={styles.demoBadgeText}>DEMO · SCRIPTED RESPONSES</Text>
            </View>
            <Text style={styles.demoDescription}>Explore example guidance. Live AI is not connected, and chat messages are not sent.</Text>

            {turns.length ? (
              <View style={styles.conversation}>
                <Pressable accessibilityRole="button" accessibilityLabel="Clear this demo conversation" onPress={() => { setTurns([]); setMessage(''); scrollRef.current?.scrollTo({ y: 0, animated: false }); }} style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}>
                  <Ionicons name="refresh-outline" size={16} color="#4E5E75" />
                  <Text style={styles.clearButtonText}>New conversation</Text>
                </Pressable>
                {turns.map(turn => (
                  <View key={turn.id} style={styles.turn}>
                    <View style={styles.userBubble}><Text style={styles.userText}>{turn.question}</Text></View>
                    <View style={styles.assistantBubble}>
                      <Text style={styles.author}>EAGLE AI · DEMO</Text>
                      <Text style={styles.answer}>{turn.answer}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.welcome}>
                <Text accessibilityRole="header" style={styles.welcomeTitle}>How can I help?</Text>
                <Text style={styles.welcomeCopy}>A little clarity for your next step.</Text>
              </View>
            )}

            <View style={styles.prompts}>
              {PROMPTS.map(prompt => (
                <Pressable key={prompt.id} accessibilityRole="button" accessibilityHint="Shows a scripted example response." onPress={() => addTurn(prompt.label, prompt.id)} style={({ pressed }) => [styles.prompt, pressed && styles.pressed]}>
                  <Ionicons name={prompt.icon} size={20} color="#092653" />
                  <Text style={styles.promptText}>{prompt.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#738094" />
                </Pressable>
              ))}
            </View>
            <View style={styles.composer}>
              <TextInput accessibilityLabel="Message Eagle AI demo" accessibilityHint="Messages receive a scripted response and are not sent to an AI service." style={styles.composerInput} value={message} onChangeText={setMessage} multiline textAlignVertical="top" maxLength={2000} placeholder="Message Eagle AI…" placeholderTextColor="#738094" autoComplete="off" textContentType="none" />
              <Pressable accessibilityRole="button" accessibilityLabel="Show demo response" accessibilityState={{ disabled: !message.trim() }} disabled={!message.trim()} onPress={() => addTurn(message)} style={({ pressed }) => [styles.sendButton, !message.trim() && styles.disabled, pressed && styles.pressed]}>
                <Ionicons name="arrow-up" size={23} color="#092653" />
              </Pressable>
            </View>
            <Text style={styles.footnote}>Chat stays in this session. Contact requests are saved only when you choose Send request.</Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function FieldLabel({ label, error }: { label: string; error?: string }) {
  return <View style={styles.fieldLabel}><Text style={styles.label}>{label}</Text>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}</View>;
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return <View style={styles.previewField}><Text style={styles.previewLabel}>{label}</Text><Text selectable style={styles.previewValue}>{value}</Text></View>;
}

export default AssistantScreen;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8F9FC' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28 },
  header: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  aiTitle: { color: '#092653', fontWeight: '800', fontSize: 25, lineHeight: 33, flexShrink: 1 },
  contactButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  contactButtonText: { color: '#092653', fontSize: 13, lineHeight: 20, fontWeight: '700' },
  demoBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#FBF3DF', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8 },
  demoDot: { height: 5, width: 5, borderRadius: 3, backgroundColor: '#95702D' },
  demoBadgeText: { flexShrink: 1, color: '#74571F', fontSize: 9, lineHeight: 14, letterSpacing: 1, fontWeight: '700' },
  demoDescription: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 9 },
  welcome: { alignItems: 'center', paddingTop: 48, paddingBottom: 38 },
  welcomeTitle: { color: '#092653', fontSize: 29, lineHeight: 37, fontWeight: '700', textAlign: 'center' },
  welcomeCopy: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 9, textAlign: 'center' },
  prompts: { gap: 9, marginTop: 12, marginBottom: 18 },
  prompt: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E1E6EF', backgroundColor: '#FFFFFF' },
  promptText: { flex: 1, color: '#092653', fontSize: 14, lineHeight: 21, fontWeight: '500' },
  conversation: { marginTop: 20, gap: 15 },
  clearButton: { alignSelf: 'flex-end', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  clearButtonText: { color: '#4E5E75', fontSize: 12, lineHeight: 18 },
  turn: { gap: 10 },
  userBubble: { alignSelf: 'flex-end', maxWidth: '92%', backgroundColor: '#092653', padding: 15, borderRadius: 18, borderBottomRightRadius: 5 },
  userText: { color: '#FFFFFF', fontSize: 14, lineHeight: 22 },
  assistantBubble: { alignSelf: 'flex-start', width: '100%', backgroundColor: '#FFFFFF', padding: 16, borderRadius: 18, borderTopLeftRadius: 5, borderColor: '#E1E6EF', borderWidth: 1 },
  author: { color: '#7F6531', fontSize: 9, letterSpacing: 1.2, fontWeight: '700', lineHeight: 15, marginBottom: 7 },
  answer: { color: '#34445D', fontSize: 14, lineHeight: 22 },
  composer: { backgroundColor: '#FFFFFF', borderColor: '#D6DFEC', borderWidth: 1, borderRadius: 18, padding: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  composerInput: { flex: 1, color: '#092653', fontSize: 15, lineHeight: 22, minHeight: 58, maxHeight: 160, paddingHorizontal: 7, paddingTop: 9, paddingBottom: 9 },
  sendButton: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#E9C675', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  footnote: { color: '#667085', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 14 },
  backButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', marginBottom: 17 },
  textButton: { color: '#092653', fontSize: 14, lineHeight: 21, fontWeight: '600' },
  eyebrow: { fontSize: 10, lineHeight: 16, letterSpacing: 1.5, fontWeight: '700', color: '#7F6531', marginBottom: 7 },
  title: { fontSize: 29, lineHeight: 37, fontWeight: '800', color: '#092653', marginBottom: 15 },
  notice: { padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 12, backgroundColor: '#EDF2FA', marginBottom: 16 },
  noticeText: { flex: 1, color: '#4E5E75', fontSize: 12, lineHeight: 18 },
  intro: { color: '#5F6B7B', fontSize: 14, lineHeight: 22, marginBottom: 19 },
  fieldLabel: { marginBottom: 7, gap: 4 },
  label: { color: '#092653', fontSize: 13, lineHeight: 20, fontWeight: '600' },
  error: { color: '#A12336', fontSize: 12, lineHeight: 18 },
  input: { backgroundColor: '#FFFFFF', borderColor: '#D6DFEC', borderWidth: 1, borderRadius: 12, color: '#092653', minHeight: 50, fontSize: 15, lineHeight: 22, paddingHorizontal: 13, paddingVertical: 12, marginBottom: 17 },
  invalidInput: { borderColor: '#A12336' },
  questionInput: { minHeight: 142, marginBottom: 5 },
  contactHelp: { color: '#5F6B7B', fontSize: 12, lineHeight: 18, marginBottom: 16 },
  characterCount: { color: '#667085', fontSize: 11, lineHeight: 17, textAlign: 'right', marginBottom: 18 },
  primaryButton: { minHeight: 52, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 14, backgroundColor: '#E9C675', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  primaryButtonText: { color: '#092653', fontSize: 15, lineHeight: 23, fontWeight: '700', flexShrink: 1 },
  previewCard: { padding: 19, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1E6EF', marginBottom: 20, gap: 19 },
  previewField: { gap: 5 },
  previewLabel: { fontSize: 11, lineHeight: 17, color: '#667085', fontWeight: '700' },
  previewValue: { fontSize: 15, lineHeight: 23, color: '#092653' },
});
