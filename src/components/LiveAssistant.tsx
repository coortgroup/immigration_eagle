import { useLanguage } from '../LanguageContext';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCloudSession } from '../cloudClient';
import { createSupportConversation, rememberSupportLoginDraft, takeSupportLoginDraft, type SupportConversationState } from '../supportChat';
import { AssistantWelcome } from './AssistantWelcome';

const emptyConversation: SupportConversationState = { messages: [], loading: false, sending: false, error: '', older: null };

/** Human correspondence only; all delivered messages and replies come from the support backend. */
export function SupportChat({ isActive, contactRequest, onAccount, accountLabel }: {
  isActive: boolean; contactRequest: number; onAccount: () => void; accountLabel: string;
}) {
  const { language, t } = useLanguage();
  const session = useCloudSession();
  const owner = session.user?.id || null;
  const initialOwner = useRef(owner);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [conversation, setConversation] = useState<{ owner: string | null; state: SupportConversationState }>({ owner, state: emptyConversation });
  const [message, setMessage] = useState('');
  const chat = useRef<ReturnType<typeof createSupportConversation> | null>(null);
  const previousOwner = useRef<string | null>(null);
  const input = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  const scrollToLatest = useRef(true);
  const state = conversation.owner === owner ? conversation.state : emptyConversation;

  useEffect(() => {
    if (previousOwner.current && previousOwner.current !== owner) { setMessage(''); rememberSupportLoginDraft(''); }
    else if (owner && initialOwner.current === owner && !previousOwner.current) {
      const pending = takeSupportLoginDraft();
      if (pending) setMessage(current => current || pending);
    }
    previousOwner.current = owner;
    setConversation({ owner, state: emptyConversation });
    if (!owner) { chat.current = null; return; }
    const controller = createSupportConversation(next => {
      if (ownerRef.current === owner) setConversation({ owner, state: next });
    });
    chat.current = controller;
    return () => { controller.dispose(); if (chat.current === controller) chat.current = null; };
  }, [owner]);

  useEffect(() => {
    if (!isActive || !owner) return;
    const refresh = () => { if (AppState.currentState === 'active' || AppState.currentState == null) void chat.current?.refresh(); };
    refresh();
    const timer = setInterval(refresh, 15_000);
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [isActive, owner]);

  useEffect(() => {
    if (isActive && contactRequest > 0) input.current?.focus();
    if (isActive && !owner) rememberSupportLoginDraft('');
  }, [contactRequest, isActive, owner]);

  function openAccount() {
    if (!owner) rememberSupportLoginDraft(message);
    onAccount();
  }

  async function send() {
    if (!message.trim() || state.sending || session.loading) return;
    if (!owner) { openAccount(); return; }
    const controller = chat.current;
    const sentText = message;
    scrollToLatest.current = true;
    const confirmed = await controller?.send(sentText);
    if (confirmed && ownerRef.current === owner && chat.current === controller) {
      rememberSupportLoginDraft('');
      setMessage(current => current === sentText ? '' : current);
      Keyboard.dismiss();
      AccessibilityInfo.announceForAccessibility(t('Message sent to the FillOut team.'));
    }
  }

  return <View style={styles.container}>
    <View style={styles.header}>
      <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{t('Chat')}</Text><Text style={styles.subtitle}>{t('FillOut team')}</Text></View>
      <Pressable accessibilityRole="button" onPress={openAccount} style={styles.account}><Ionicons name="person-circle-outline" size={22} color="#092653" /><Text style={styles.accountText}>{t(accountLabel)}</Text></Pressable>
    </View>
    <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.chatContent} keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag" onContentSizeChange={() => { if (scrollToLatest.current) scroll.current?.scrollToEnd({ animated: true }); }}>
      {state.older && <Pressable accessibilityRole="button" disabled={state.loading} onPress={() => { scrollToLatest.current = false; void chat.current?.refresh(true); }} style={styles.history}><Text style={styles.link}>{t('Earlier messages')}</Text></Pressable>}
      {state.messages.length ? <View style={styles.conversation}>{state.messages.map(item => <View key={item.id} style={[styles.bubble, item.sender === 'customer' ? styles.customer : styles.team]}>
        {item.sender === 'team' && <Text style={styles.author}>{t('FillOut team')}</Text>}
        <Text selectable style={item.sender === 'customer' ? styles.customerText : styles.teamText}>{item.body}</Text>
        <Text style={[styles.time, item.sender === 'customer' && styles.customerTime]}>{new Date(item.createdAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{item.sender === 'customer' ? ` · ${t('Sent')}` : ''}</Text>
      </View>)}</View> : <AssistantWelcome />}
    </ScrollView>
    <View style={styles.composerDock}>
      {!!state.error && <View style={styles.errorRow}><Text accessibilityRole="alert" style={styles.error}>{t(state.error)}</Text>
        <Pressable accessibilityRole="button" disabled={state.loading || state.sending} onPress={() => void chat.current?.refresh()} style={styles.retry}><Text style={styles.link}>{t('Refresh')}</Text></Pressable></View>}
      {!!session.error && <Text accessibilityRole="alert" style={styles.error}>{t(session.error)}</Text>}
      {!session.configured && <Text style={styles.status}>{t('Chat is not connected in this version. Your message has not been sent.')}</Text>}
      {session.configured && !owner && <Text style={styles.status}>{t('Log in to send a message and keep your conversation.')}</Text>}
      {state.loading && <Text accessibilityLiveRegion="polite" style={styles.status}>{t('Updating conversation…')}</Text>}
      <View style={styles.composer}>
        <TextInput ref={input} accessibilityLabel={t('Message the FillOut team')} style={styles.input} value={message} onChangeText={value => { setMessage(value); if (!owner) rememberSupportLoginDraft(''); }}
          placeholder={t('Write a message…')} placeholderTextColor="#738094" multiline maxLength={2000} editable={!state.sending}
          textAlignVertical="top" autoCorrect autoComplete="off" textContentType="none" />
        <Pressable accessibilityRole="button" accessibilityLabel={t(owner ? 'Send message' : 'Login to send')} disabled={!message.trim() || state.sending || session.loading}
          accessibilityState={{ disabled: !message.trim() || state.sending || session.loading }} onPress={() => void send()}
          style={({ pressed }) => [styles.send, (!message.trim() || state.sending || session.loading) && styles.disabled, pressed && { opacity: 0.7 }]}>
          <Ionicons name={state.sending ? 'hourglass-outline' : 'send-outline'} size={20} color="#092653" />
        </Pressable>
      </View>
      <Text style={styles.footnote}>{state.sending ? t('Sending…') : t('Messages are shared with the FillOut team. Replies appear here.')}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 20, paddingBottom: 14, gap: 12 },
  heading: { flex: 1, gap: 3 },
  title: { color: '#092653', fontSize: 29, lineHeight: 37, fontWeight: '800' },
  subtitle: { color: '#667085', fontSize: 13, lineHeight: 20 },
  account: { flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 44, maxWidth: '48%' },
  accountText: { color: '#092653', fontSize: 13, lineHeight: 20, flexShrink: 1 },
  scroll: { flex: 1 },
  chatContent: { flexGrow: 1, paddingBottom: 14 },
  history: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  link: { color: '#092653', fontSize: 13, lineHeight: 20, fontWeight: '600' },
  conversation: { gap: 14, paddingTop: 8 },
  bubble: { maxWidth: '92%', padding: 15, borderRadius: 17 },
  customer: { alignSelf: 'flex-end', backgroundColor: '#092653', borderTopRightRadius: 5 },
  team: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1E6EF', borderTopLeftRadius: 5 },
  customerText: { color: '#FFFFFF', fontSize: 15, lineHeight: 23 },
  teamText: { color: '#34445D', fontSize: 15, lineHeight: 23 },
  author: { color: '#7F6531', fontSize: 12, lineHeight: 18, fontWeight: '700', marginBottom: 7 },
  time: { color: '#667085', fontSize: 10, lineHeight: 16, marginTop: 7 },
  customerTime: { color: '#CEDBEC' },
  composerDock: { paddingBottom: 10, gap: 7 },
  composer: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D6DFEC', borderRadius: 18, padding: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 46, maxHeight: 130, color: '#092653', fontSize: 15, lineHeight: 22, paddingHorizontal: 7, paddingTop: 11, paddingBottom: 9 },
  send: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#E9C675', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  error: { flexShrink: 1, color: '#A12336', fontSize: 12, lineHeight: 18 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 5 },
  status: { color: '#5F6B7B', fontSize: 12, lineHeight: 18 },
  footnote: { color: '#667085', fontSize: 10, lineHeight: 15, textAlign: 'center' },
});
