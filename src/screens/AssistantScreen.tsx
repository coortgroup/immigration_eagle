import React, { useEffect, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SupportChat } from '../components/LiveAssistant';
import { useCloudSession } from '../cloudClient';
import { useLanguage } from '../LanguageContext';
import { supportOperatorAccess } from '../supportInbox';
import { SupportInboxScreen } from './SupportInboxScreen';
import { FormReviewInboxScreen } from './FormReviewInboxScreen';

export type AssistantScreenProps = {
  /** A Contact us action opens and focuses this same team conversation. */
  contactRequest?: number;
  isActive?: boolean;
  onAccount?: () => void;
  accountLabel?: string;
};

export function AssistantScreen({ contactRequest = 0, isActive = true, onAccount = () => {}, accountLabel = 'Login' }: AssistantScreenProps) {
  const { t } = useLanguage();
  const session = useCloudSession();
  const owner = session.user?.id;
  const [operator,setOperator] = useState<string | null>(null);
  const [inbox,setInbox] = useState<'messages' | 'reviews' | null>(null);
  useEffect(() => { setInbox(null); setOperator(null); },[owner]);
  useEffect(() => { if (contactRequest) setInbox(null); },[contactRequest]);
  useEffect(() => {
    if (!owner || !isActive || !session.configured) return;
    let active = true;
    const check = async () => { if (AppState.currentState !== 'active' && AppState.currentState != null) return; try {
      const allowed = await supportOperatorAccess();
      if (active) { setOperator(allowed ? owner : null); if (!allowed) setInbox(null); }
    } catch { /* A transient refresh error must not discard an unsent reply. Data requests still authorize every call. */ } };
    void check(); const timer = setInterval(() => void check(),60_000);
    return () => { active = false; clearInterval(timer); };
  },[owner,isActive,session.configured]);
  const allowed = !!owner && operator === owner;
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {allowed && inbox === 'reviews' ? <FormReviewInboxScreen key={owner} isActive={isActive} onClose={() => setInbox(null)} /> : allowed && inbox === 'messages' ? <SupportInboxScreen key={owner} isActive={isActive} onClose={() => setInbox(null)} /> : <>
      {allowed && <View style={styles.operatorActions}><Pressable accessibilityRole="button" onPress={() => setInbox('messages')} style={styles.inbox}><Text style={styles.inboxText}>{t('Client messages')}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setInbox('reviews')} style={styles.inbox}><Text style={styles.inboxText}>{t('Forms for review')}</Text></Pressable></View>}
      <SupportChat contactRequest={contactRequest} isActive={isActive && !inbox} onAccount={onAccount} accountLabel={accountLabel} />
    </>}
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({ screen: { flex: 1, minHeight: 0, backgroundColor: '#F6F8FC' },operatorActions: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#FFF3D5' },inbox: { flexGrow: 1, minHeight: 44, paddingHorizontal: 12,justifyContent: 'center',alignItems: 'center',backgroundColor: '#FFF3D5' },inboxText: { color: '#092653',fontWeight: '700',fontSize: 14 } });
