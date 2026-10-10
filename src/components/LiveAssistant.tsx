import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { invokeCloudFunction, useCloudSession } from '../cloudClient';
import { EmailAccess } from './EmailAccess';

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
  const pending = useRef(false);
  const generation = useRef(0);

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
    try {
      const result = await invokeCloudFunction<{ answer: string }>('ai-assistant', { consent: true, messages: chatMessages(turns, trimmed) });
      if (typeof result?.answer !== 'string' || !result.answer.trim() || result.answer.length > 8000) throw new Error('AI could not finish an answer. Please try again.');
      if (requestGeneration !== generation.current) return;
      setTurns(current => [...current, { question: trimmed, answer: result.answer }]);
      setMessage('');
      AccessibilityInfo.announceForAccessibility('FILLOUT AI replied.');
    } catch (err) {
      if (requestGeneration === generation.current) setError(err instanceof Error ? err.message : 'AI is unavailable. Please try again.');
    } finally {
      if (requestGeneration === generation.current) { pending.current = false; setSending(false); }
    }
  }

  const disabled = sending || !consent || !session.user;
  return <View style={styles.container}>
    <Text style={styles.title}>How can I help?</Text>
    <Text style={styles.copy}>Ask about using FILLOUT or understanding form terminology. Check current requirements with USCIS or a qualified immigration attorney.</Text>
    <EmailAccess disabled={sending} purpose="assistant" />
    {!!session.user && !consent && <View style={styles.notice}>
      <Text style={styles.copy}>AI chat sends your messages and recent chat history to OpenAI through our server. Avoid names, identification numbers and document details. AI can make mistakes and does not determine eligibility or file forms.</Text>
      <Pressable accessibilityRole="button" onPress={() => setConsent(true)} style={styles.button}><Text style={styles.buttonText}>Enable AI chat</Text></Pressable>
    </View>}
    {!!turns.length && <Pressable accessibilityRole="button" disabled={sending} onPress={() => { setTurns([]); setMessage(''); setError(''); }} style={styles.textButton}><Text style={styles.link}>New conversation</Text></Pressable>}
    {turns.map((turn, index) => <View key={index} style={styles.turn}>
      <View style={styles.question}><Text style={styles.questionText}>{turn.question}</Text></View>
      <View style={styles.answer}><Text style={styles.author}>FILLOUT AI</Text><Text selectable style={styles.answerText}>{turn.answer}</Text></View>
    </View>)}
    {!turns.length && consent && <View style={styles.prompts}>
      {['How do I find a form in FILLOUT?', 'What should I check before filling out a form?'].map(prompt => <Pressable key={prompt} accessibilityRole="button" disabled={disabled} onPress={() => { setMessage(prompt); void send(prompt); }} style={styles.prompt}><Text style={styles.link}>{prompt}</Text></Pressable>)}
    </View>}
    <View style={styles.composer}>
      <TextInput accessibilityLabel="Message FILLOUT AI" editable={!disabled} value={message} onChangeText={setMessage} maxLength={2000} multiline textAlignVertical="top" placeholder="Message FILLOUT AI…" placeholderTextColor="#738094" style={styles.input} autoComplete="off" textContentType="none" />
      <Pressable accessibilityRole="button" accessibilityLabel="Send message to FILLOUT AI" accessibilityState={{ disabled: disabled || !message.trim() }} disabled={disabled || !message.trim()} onPress={() => void send(message)} style={[styles.send, (disabled || !message.trim()) && styles.disabled]}><Ionicons name="arrow-up" size={23} color="#092653" /></Pressable>
    </View>
    {sending && <Text accessibilityLiveRegion="polite" style={styles.copy}>FILLOUT AI is replying…</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Text style={styles.footnote}>Your chat is not a legal consultation. Chat history is kept only for this app session; messages sent to the AI provider are subject to its retention policy.</Text>
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 14, marginTop: 15 },
  title: { color: '#092653', fontSize: 29, lineHeight: 37, fontWeight: '700' },
  copy: { color: '#5F6B7B', fontSize: 14, lineHeight: 22 },
  notice: { padding: 16, gap: 12, borderRadius: 16, backgroundColor: '#EDF2FA' },
  button: { backgroundColor: '#E9C675', minHeight: 48, padding: 14, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#092653', fontWeight: '700', fontSize: 15 },
  textButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-end' },
  link: { color: '#092653', fontSize: 14, lineHeight: 22 },
  turn: { gap: 10 },
  question: { alignSelf: 'flex-end', maxWidth: '92%', backgroundColor: '#092653', padding: 15, borderRadius: 16 },
  questionText: { color: '#FFFFFF', fontSize: 14, lineHeight: 22 },
  answer: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E1E6EF' },
  author: { color: '#7F6531', fontSize: 10, letterSpacing: 1, fontWeight: '700', marginBottom: 8 },
  answerText: { color: '#34445D', fontSize: 14, lineHeight: 22 },
  prompts: { gap: 10 },
  prompt: { padding: 14, minHeight: 48, borderWidth: 1, borderColor: '#E1E6EF', borderRadius: 12, backgroundColor: '#FFFFFF' },
  composer: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D6DFEC', borderRadius: 16, padding: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 58, maxHeight: 160, color: '#092653', fontSize: 15, lineHeight: 22, padding: 8 },
  send: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#E9C675', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  error: { color: '#A12336', fontSize: 13, lineHeight: 20 },
  footnote: { color: '#667085', fontSize: 11, lineHeight: 17, textAlign: 'center' },
});
