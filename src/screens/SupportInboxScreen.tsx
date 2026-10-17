import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLanguage } from '../LanguageContext';
import { createOperatorConversation, listClientConversations, type ClientConversation, type InboxCursor } from '../supportInbox';
import type { SupportConversationState } from '../supportChat';

function Link({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={[styles.link, disabled && styles.disabled]}><Text style={styles.linkText}>{label}</Text></Pressable>;
}

function ClientMessages({ client, isActive, onBack }: { client: ClientConversation; isActive: boolean; onBack: () => void }) {
  const { t, language } = useLanguage();
  const [state,setState] = useState<SupportConversationState>({ messages: [], loading: false, sending: false, error: '', older: null });
  const [body,setBody] = useState('');
  const controller = useRef<ReturnType<typeof createOperatorConversation> | null>(null);
  const scroll = useRef<ScrollView>(null);
  const followLatest = useRef(true);
  useEffect(() => {
    const chat = createOperatorConversation(client.userId,setState); controller.current = chat;
    return () => { chat.dispose(); controller.current = null; };
  },[client.userId]);
  useEffect(() => {
    if (!isActive) return;
    const refresh = () => { if (AppState.currentState === 'active' || AppState.currentState == null) void controller.current?.refresh(); };
    refresh(); const timer = setInterval(refresh,15_000);
    const subscription = AppState.addEventListener('change',next => { if (next === 'active') refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  },[isActive,client.userId]);
  async function send() {
    if (state.sending || !body.trim()) return;
    const chat = controller.current, sent = body;
    followLatest.current = true;
    if (await chat?.send(sent) && chat === controller.current) setBody(current => current === sent ? '' : current);
  }
  return <View style={styles.screen}>
    <View style={styles.header}><Link label={t('Client messages')} onPress={onBack} disabled={state.sending || !!body.trim()} /><Text numberOfLines={2} style={styles.email}>{client.email}</Text></View>
    <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => { if (followLatest.current) scroll.current?.scrollToEnd({ animated: true }); }}>
      {state.older && <Link label={t('Earlier messages')} disabled={state.loading} onPress={() => { followLatest.current = false; void controller.current?.refresh(true); }} />}
      {state.messages.map(message => <View key={message.id} style={[styles.bubble,message.sender === 'team' ? styles.team : styles.client]}>
        <Text style={styles.author}>{t(message.sender === 'team' ? 'FillOut team' : 'Client')}</Text>
        <Text selectable style={styles.body}>{message.body}</Text>
        <Text style={styles.time}>{new Date(message.createdAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US')}</Text>
      </View>)}
      {!state.loading && !state.messages.length && <Text style={styles.note}>{t('No messages yet.')}</Text>}
    </ScrollView>
    <View style={styles.dock}>
      {!!state.error && <Text accessibilityRole="alert" style={styles.error}>{t(state.error)}</Text>}
      <View style={styles.statusRow}><Text style={styles.note}>{t(state.loading ? 'Updating conversation…' : 'Replies are sent as FillOut team.')}</Text><Link label={t('Refresh')} disabled={state.loading} onPress={() => void controller.current?.refresh()} /></View>
      <View style={styles.composer}><TextInput accessibilityLabel={t('Reply to client')} placeholder={t('Write a reply…')} placeholderTextColor="#667085" value={body} onChangeText={setBody}
        style={styles.input} multiline maxLength={2000} editable={!state.sending} textAlignVertical="top" />
        <Pressable accessibilityRole="button" accessibilityLabel={t('Send reply')} onPress={() => void send()} disabled={!body.trim() || state.sending} style={[styles.send,(!body.trim() || state.sending) && styles.disabled]}>
          <Ionicons name={state.sending ? 'hourglass-outline' : 'send-outline'} size={22} color="#092653" />
        </Pressable></View>
      {!!body.trim() && <Text style={styles.note}>{t('Send or clear your reply before switching conversations.')}</Text>}
    </View>
  </View>;
}

export function SupportInboxScreen({ isActive, onClose }: { isActive: boolean; onClose: () => void }) {
  const { t, language } = useLanguage();
  const [clients,setClients] = useState<ClientConversation[]>([]);
  const [selected,setSelected] = useState<ClientConversation | null>(null);
  const [older,setOlder] = useState<InboxCursor | null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const busy = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; },[]);
  async function refresh(before?: InboxCursor) {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError('');
    try {
      const result = await listClientConversations(before);
      if (!mounted.current) return;
      setClients(previous => {
        const all = new Map((before ? previous : []).map(client => [client.userId,client]));
        result.conversations.forEach(client => all.set(client.userId,client));
        return [...all.values()].sort((a,b) => Date.parse(b.lastCreatedAt)-Date.parse(a.lastCreatedAt) || b.userId.localeCompare(a.userId));
      });
      setOlder(result.nextBefore);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Client messages could not be loaded. Please try again.'); }
    finally { busy.current = false; if (mounted.current) setLoading(false); }
  }
  useEffect(() => {
    if (!isActive || selected) return;
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active' || AppState.currentState == null) void refresh(); },30_000);
    return () => clearInterval(timer);
  },[isActive,selected]);
  if (selected) return <ClientMessages key={selected.userId} client={selected} isActive={isActive} onBack={() => setSelected(null)} />;
  return <View style={styles.screen}>
    <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>{t('Client messages')}</Text><Link label={t('My chat')} onPress={onClose} /></View>
    <View style={styles.statusRow}><Text style={styles.note}>{t('Open a conversation to reply personally.')}</Text><Link label={t('Refresh')} disabled={loading} onPress={() => void refresh()} /></View>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
    <ScrollView contentContainerStyle={styles.list}>
      {!clients.length && <Text style={styles.note}>{t(loading ? 'Loading client messages…' : 'No client messages yet.')}</Text>}
      {clients.map(client => <Pressable key={client.userId} accessibilityRole="button" onPress={() => setSelected(client)} style={styles.row}>
        <View style={styles.statusRow}><Text style={styles.email}>{client.email}</Text>{client.needsReply && <Text style={styles.badge}>{t('Needs reply')}</Text>}</View>
        <Text numberOfLines={2} style={styles.body}>{client.preview}</Text><Text style={styles.time}>{new Date(client.lastCreatedAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US')}</Text>
      </Pressable>)}
      {older && <Link label={t('More conversations')} disabled={loading} onPress={() => void refresh(older)} />}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, paddingHorizontal: 20 }, header: { flexDirection: 'row',alignItems: 'center',justifyContent: 'space-between',gap: 12,paddingTop: 16,paddingBottom: 8 },
  title: { flex: 1,fontSize: 24,fontWeight: '800',color: '#092653' }, link: { minHeight: 44,justifyContent: 'center',paddingHorizontal: 4 },
  linkText: { fontSize: 14,fontWeight: '600',color: '#092653' }, email: { flex: 1,fontSize: 14,fontWeight: '700',color: '#092653' },
  statusRow: { flexDirection: 'row',alignItems: 'center',justifyContent: 'space-between',gap: 8 }, note: { flexShrink: 1,fontSize: 12,lineHeight: 18,color: '#667085' },
  list: { gap: 12,paddingVertical: 12 }, row: { backgroundColor: '#FFFFFF',borderColor: '#DCE3ED',borderWidth: 1,borderRadius: 16,padding: 16,gap: 8 },
  badge: { color: '#806118',backgroundColor: '#FFF5D9',padding: 5,fontSize: 11,borderRadius: 5 }, body: { color: '#253B5D',fontSize: 15,lineHeight: 22 },
  time: { color: '#667085',fontSize: 10,lineHeight: 15 }, scroll: { flex: 1 }, messages: { gap: 12,paddingVertical: 12 },
  bubble: { maxWidth: '92%',padding: 14,borderRadius: 16,gap: 7 }, team: { alignSelf: 'flex-end',backgroundColor: '#E8F0FE' },client: { alignSelf: 'flex-start',backgroundColor: '#FFFFFF' },
  author: { color: '#667085',fontWeight: '700',fontSize: 11 },dock: { gap: 6,paddingBottom: 10 },error: { color: '#A12336',fontSize: 12,lineHeight: 18 },
  composer: { flexDirection: 'row',alignItems: 'flex-end',gap: 8,padding: 8,borderRadius: 18,backgroundColor: '#FFFFFF',borderWidth: 1,borderColor: '#D6DFEC' },
  input: { flex: 1,minHeight: 44,maxHeight: 130,padding: 9,color: '#092653',fontSize: 15,lineHeight: 22 }, send: { width: 44,height: 44,borderRadius: 12,backgroundColor: '#E9C675',alignItems: 'center',justifyContent: 'center' },disabled: { opacity: 0.4 },
});
