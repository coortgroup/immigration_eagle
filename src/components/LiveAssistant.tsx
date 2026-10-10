import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { invokeCloudFunction, useCloudSession } from '../cloudClient';
import { EmailAccess } from './EmailAccess';
import { AssistantWelcome } from './AssistantWelcome';

type Turn = { question: string; answer: string };
export const liveAiEnabled = process.env.EXPO_PUBLIC_ENABLE_LIVE_AI === 'true';

export function chatMessages(turns: Turn[], question: string) {
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  let length = question.length;
  for (const turn of turns.slice(-4).reverse()) {
    const pair: typeof history = [{ role: 'user', content: turn.question }, { role: 'assistant', content: turn.answer.slice(0, 2000) }];
    const pairLength = pair.reduce((total, item) => total + item.content.length, 0);
    if (length + pairLength > 10000) break;
    history.unshift(...pair);
    length += pairLength;
  }
  return [...history, { role: 'user' as const, content: question }];
}

export function LiveAssistant() {
  const session = useCloudSession();
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [accessOpen, setAccessOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const shouldScrollChat = useRef(false);

  useEffect(() => {
    generation.current += 1;
    setTurns([]); setMessage(''); setError(''); setConsent(false); setSending(false);
    pending.current = false;
    return () => { generation.current += 1; };
  }, [session.user?.id]);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending.current || !consent || !session.user) return;
    const requestGeneration = generation.current;
    pending.current = true; setSending(true); setError('');
    setExamplesOpen(false);
    try {
      const result = await invokeCloudFunction<{ answer: string }>('ai-assistant', { consent: true, messages: chatMessages(turns, trimmed) });
      if (typeof result?.answer !== 'string' || !result.answer.trim() || result.answer.length > 8000) throw new Error('AI could not finish an answer. Please try again.');
      if (requestGeneration !== generation.current) return;
      shouldScrollChat.current = true;
      setTurns(current => [...current, { question: trimmed, answer: result.answer }]);
      setMessage('');
      Keyboard.dismiss();
      AccessibilityInfo.announceForAccessibility('FILLOUT AI replied.');
    } catch (err) {
      if (requestGeneration === generation.current) setError(err instanceof Error ? err.message : 'AI is unavailable. Please try again.');
    } finally {
      if (requestGeneration === generation.current) { pending.current = false; setSending(false); }
    }
  }

  const disabled = sending || !consent || !session.user;
  return <View style={styles.container}>
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.chatContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onContentSizeChange={() => {
        if (shouldScrollChat.current && !accessOpen) {
          shouldScrollChat.current = false;
          scrollRef.current?.scrollToEnd({ animated: true });
        }
      }}
    >
      {accessOpen ? <View style={styles.access}>
        <Pressable accessibilityRole="button" onPress={() => { Keyboard.dismiss(); setAccessOpen(false); }} style={styles.backButton}>
          <Ionicons name="chevron-back" size={18} color="#092653" /><Text style={styles.link}>Back to chat</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>Chat access</Text>
        <Text style={styles.copy}>Ask about using FILLOUT or understanding form terminology. Check current requirements with USCIS or a qualified immigration attorney.</Text>
        <EmailAccess disabled={sending} purpose="assistant" />
        {!!session.user && !consent && <View style={styles.notice}>
          <Text style={styles.copy}>AI chat sends your messages and recent chat history to OpenAI through our server. Avoid names, identification numbers and document details. AI can make mistakes and does not determine eligibility or file forms.</Text>
          <Pressable accessibilityRole="button" onPress={() => { setConsent(true); setAccessOpen(false); Keyboard.dismiss(); }} style={styles.button}><Text style={styles.buttonText}>Enable AI chat</Text></Pressable>
        </View>}
        <Text style={styles.privacy}>Your chat is not a legal consultation. Chat history is kept only for this app session; messages sent to the AI provider are subject to its retention policy.</Text>
      </View> : turns.length ? <View style={styles.conversation}>
        <Pressable accessibilityRole="button" disabled={sending} onPress={() => { setTurns([]); setMessage(''); setError(''); scrollRef.current?.scrollTo({ y: 0, animated: false }); }} style={styles.textButton}><Text style={styles.link}>New conversation</Text></Pressable>
        {turns.map((turn, index) => <View key={index} style={styles.turn}>
          <View style={styles.question}><Text style={styles.questionText}>{turn.question}</Text></View>
          <View style={styles.answer}><Text style={styles.author}>FILLOUT AI</Text><Text selectable style={styles.answerText}>{turn.answer}</Text></View>
        </View>)}
      </View> : <AssistantWelcome />}
    </ScrollView>
    {!accessOpen && <View style={styles.composerDock}>
    <View style={styles.accessRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={session.user && consent ? 'Manage chat access and privacy' : session.user ? 'Enable AI chat' : 'Verify email to start chatting'} onPress={() => { Keyboard.dismiss(); setAccessOpen(true); scrollRef.current?.scrollTo({ y: 0, animated: false }); }} style={styles.accessButton}>
        <Ionicons name={session.user && consent ? 'settings-outline' : 'lock-closed-outline'} size={13} color="#667085" />
        <Text style={styles.accessText}>{session.user && consent ? 'Chat access & privacy' : session.user ? 'Enable AI chat' : 'Verify email to start chatting'}</Text>
      </Pressable>
      {consent && <Pressable accessibilityRole="button" accessibilityState={{ expanded: examplesOpen }} onPress={() => setExamplesOpen(current => !current)} style={styles.accessButton}><Text style={styles.accessText}>Examples</Text><Ionicons name={examplesOpen ? 'chevron-down' : 'chevron-up'} size={13} color="#667085" /></Pressable>}
    </View>
    {examplesOpen && consent && <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.prompts}>
      {['How do I find a form in FILLOUT?', 'What should I check before filling out a form?'].map(prompt => <Pressable key={prompt} accessibilityRole="button" disabled={disabled} onPress={() => { setMessage(prompt); void send(prompt); }} style={styles.prompt}><Text style={styles.promptText}>{prompt}</Text></Pressable>)}
    </ScrollView>}
    <View style={styles.composer}>
      <TextInput accessibilityLabel="Message FILLOUT AI" editable={!disabled} value={message} onChangeText={setMessage} maxLength={2000} multiline textAlignVertical="top" placeholder="Message FILLOUT AI…" placeholderTextColor="#738094" style={styles.input} autoComplete="off" textContentType="none" />
      <Pressable accessibilityRole="button" accessibilityLabel="Send message to FILLOUT AI" accessibilityState={{ disabled: disabled || !message.trim() }} disabled={disabled || !message.trim()} onPress={() => void send(message)} style={[styles.send, (disabled || !message.trim()) && styles.disabled]}><Ionicons name="arrow-up" size={23} color="#092653" /></Pressable>
    </View>
    {sending && <Text accessibilityLiveRegion="polite" style={styles.status}>FILLOUT AI is replying…</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Text style={styles.footnote}>AI can make mistakes. Check important information.</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  scroll: { flex: 1 },
  chatContent: { flexGrow: 1, paddingBottom: 14 },
  access: { gap: 12, paddingTop: 6 },
  backButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  title: { color: '#092653', fontSize: 25, lineHeight: 33, fontWeight: '700' },
  copy: { color: '#5F6B7B', fontSize: 14, lineHeight: 22 },
  notice: { padding: 16, gap: 12, borderRadius: 16, backgroundColor: '#EDF2FA' },
  button: { backgroundColor: '#E9C675', minHeight: 48, padding: 14, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#092653', fontWeight: '700', fontSize: 15 },
  textButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-end' },
  link: { color: '#092653', fontSize: 14, lineHeight: 22 },
  conversation: { gap: 14, paddingTop: 8 },
  turn: { gap: 10 },
  question: { alignSelf: 'flex-end', maxWidth: '92%', backgroundColor: '#092653', padding: 15, borderRadius: 16 },
  questionText: { color: '#FFFFFF', fontSize: 14, lineHeight: 22 },
  answer: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E1E6EF' },
  author: { color: '#7F6531', fontSize: 10, letterSpacing: 1, fontWeight: '700', marginBottom: 8 },
  answerText: { color: '#34445D', fontSize: 14, lineHeight: 22 },
  composerDock: { paddingBottom: 8 },
  accessRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  accessButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5 },
  accessText: { color: '#667085', fontSize: 11, lineHeight: 17 },
  prompts: { gap: 7, paddingBottom: 8 },
  prompt: { paddingHorizontal: 12, paddingVertical: 9, minHeight: 44, borderWidth: 1, borderColor: '#E1E6EF', borderRadius: 14, backgroundColor: '#FFFFFF', justifyContent: 'center' },
  promptText: { color: '#092653', fontSize: 12, lineHeight: 18 },
  composer: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D6DFEC', borderRadius: 18, padding: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 46, maxHeight: 130, color: '#092653', fontSize: 15, lineHeight: 22, paddingHorizontal: 7, paddingTop: 11, paddingBottom: 9 },
  send: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#E9C675', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  error: { color: '#A12336', fontSize: 12, lineHeight: 18, marginTop: 6 },
  status: { color: '#5F6B7B', fontSize: 12, lineHeight: 18, marginTop: 6 },
  footnote: { color: '#667085', fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 6 },
  privacy: { color: '#667085', fontSize: 11, lineHeight: 17 },
});
