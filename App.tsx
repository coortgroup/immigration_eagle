import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LanguageProvider, useLanguage } from './src/LanguageContext';
import FormsFlow from './src/screens/FormsFlow';
import { AssistantScreen } from './src/screens/AssistantScreen';
import { ApplicationScreen } from './src/screens/ApplicationScreen';
import type { DraftSummary } from './src/types';
import { deleteDraft, listDrafts } from './src/draftStorage';
import { colors } from './src/theme';
import { AccountProvider, useAccount } from './src/AccountContext';
import { AccountScreen } from './src/screens/AccountScreen';
import { Button } from './src/components/UI';
import { MyReviewSubmissions } from './src/components/MyReviewSubmissions';

type Tab = 'home' | 'application' | 'ai';
type ApplicationDestination = { formId: string; resume: boolean };

function EagleApp({ initialTab, onTabChange, draftOwner }: { initialTab?: Tab; onTabChange?: (tab: Tab) => void; draftOwner?: string | null } = {}) {
  const { t } = useLanguage();
  const account = useAccount();
  const query = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : undefined;
  const [tab,setTab]=useState<Tab>(initialTab || (query?.get('screen') === 'contact' ? 'ai' : query?.get('form') ? 'application' : 'home'));
  useEffect(()=>{onTabChange?.(tab);},[tab,onTabChange]);
  const [contactRequest,setContactRequest]=useState(query?.get('screen') === 'contact' ? 1 : 0);
  const [applicationKey,setApplicationKey]=useState(0);
  const [initialFormId,setInitialFormId]=useState(query?.get('form') || undefined);
  const [applicationFlowOpen,setApplicationFlowOpen]=useState(!!query?.get('form'));
  const [applicationReturnRequest,setApplicationReturnRequest]=useState(0);
  const pendingApplicationDestination=useRef<ApplicationDestination | null>(null);
  const [drafts,setDrafts]=useState<DraftSummary[]>([]);
  const [draftError,setDraftError]=useState('');
  const [draftsLoading,setDraftsLoading]=useState(true);
  const [resumeFormId,setResumeFormId]=useState<string>();
  const [resumeRequest,setResumeRequest]=useState(0);
  const [draftSaveFailed,setDraftSaveFailed]=useState(false);
  const [accountOpen,setAccountOpen]=useState(query?.get('screen') === 'account');
  const refreshDrafts=async()=>{
    try { setDrafts(await listDrafts()); setDraftError(''); }
    catch(error) {setDraftError(error instanceof Error ? error.message : 'Could not load your saved drafts.');}
    finally {setDraftsLoading(false);}
  };
  useEffect(()=>{void refreshDrafts();},[]);
  const removeDraft=async(formId:string)=>{
    await deleteDraft(formId);
    await refreshDrafts();
  };
  const openApplicationDestination=(destination:ApplicationDestination)=>{
    setTab('application');setApplicationFlowOpen(true);
    if(destination.resume) {
      setResumeFormId(destination.formId);setResumeRequest(n=>n+1);
    } else {
      setInitialFormId(destination.formId);setResumeFormId(undefined);setResumeRequest(0);setApplicationKey(n=>n+1);
    }
  };
  const requestApplicationDestination=(destination:ApplicationDestination)=>{
    setTab('application');setApplicationFlowOpen(true);
    pendingApplicationDestination.current=null;
    if (draftSaveFailed) return;
    if(initialFormId||resumeFormId) {
      // The retained editor may still be saving while Home or the list is shown.
      // Replace it only after its existing return handler confirms the save.
      pendingApplicationDestination.current=destination;
      setApplicationReturnRequest(value=>value+1);
    } else openApplicationDestination(destination);
  };
  const resumeDraft=(formId:string)=>requestApplicationDestination({formId,resume:true});
  const selectApplicationForm=(formId:string)=>requestApplicationDestination({formId,resume:false});
  const openContact=()=>{setContactRequest(n=>n+1);setTab('ai');};
  const openApplications=()=>{
    const destination=pendingApplicationDestination.current;
    pendingApplicationDestination.current=null;
    if(destination) openApplicationDestination(destination);
    else {setApplicationFlowOpen(false);setTab('application');void refreshDrafts();}
  };
  const selectTab=(next:Tab)=>{
    setTab(next);
    if(next==='application') {
      pendingApplicationDestination.current=null;
      if(applicationFlowOpen) setApplicationReturnRequest(value=>value+1);
      else void refreshDrafts();
    }
  };
  const applicationFlowVisible=tab==='application'&&applicationFlowOpen&&!accountOpen;
  return <SafeAreaView style={styles.safe} edges={['top','bottom']}>
    <StatusBar style="dark" />
    <View style={styles.shell}>
      <View style={[styles.panel,(tab!=='home'||accountOpen)&&styles.hidden]} accessibilityElementsHidden={tab!=='home'||accountOpen} importantForAccessibility={tab!=='home'||accountOpen?'no-hide-descendants':'auto'}><FormsFlow onAccount={()=>setAccountOpen(true)} draftOwner={draftOwner} isActive={tab==='home'&&!accountOpen} onContact={openContact} onOpenApplicationForm={selectApplicationForm}/></View>
      {/* Keep the editor in this panel when switching tabs or showing the list. */}
      <View style={[styles.panel,!applicationFlowVisible&&styles.hidden]} accessibilityElementsHidden={!applicationFlowVisible} importantForAccessibility={!applicationFlowVisible?'no-hide-descendants':'auto'}>{(initialFormId||resumeFormId)&&<FormsFlow onAccount={()=>setAccountOpen(true)} key={applicationKey} draftOwner={draftOwner} initialFormId={initialFormId} resumeFormId={resumeFormId} resumeRequest={resumeRequest} applicationReturnRequest={applicationReturnRequest} isActive={applicationFlowVisible} onContact={openContact} onExitToApplications={openApplications} onDraftSaved={()=>{void refreshDrafts();}} onSaveErrorChange={setDraftSaveFailed}/>}</View>
      <View style={[styles.panel,(tab!=='application'||applicationFlowOpen||accountOpen)&&styles.hidden]} accessibilityElementsHidden={tab!=='application'||applicationFlowOpen||accountOpen} importantForAccessibility={tab!=='application'||applicationFlowOpen||accountOpen?'no-hide-descendants':'auto'}>
        <ApplicationScreen reviewPanel={<MyReviewSubmissions isActive={tab==='application'&&!applicationFlowOpen&&!accountOpen} editableCases={drafts.filter(draft=>draft.mode==='ai'&&draft.stage==='fullPreparation').map(draft=>({formId:draft.formId,caseId:draft.paymentCaseId || null}))} onEdit={resumeDraft}/>} drafts={drafts} loading={draftsLoading} error={draftError} onRetry={()=>{void refreshDrafts();}} onRemove={removeDraft} onResume={resumeDraft} onSelectForm={selectApplicationForm}/>
      </View>
      <View style={[styles.panel,(tab!=='ai'||accountOpen)&&styles.hidden]} accessibilityElementsHidden={tab!=='ai'||accountOpen} importantForAccessibility={tab!=='ai'||accountOpen?'no-hide-descendants':'auto'}><AssistantScreen isActive={tab==='ai'&&!accountOpen} contactRequest={contactRequest} onAccount={()=>setAccountOpen(true)} accountLabel={account.user?'My account':'Login'}/></View>
      {accountOpen && <AccountScreen onClose={()=>setAccountOpen(false)} />}
      {!accountOpen && <View style={styles.tabs} accessibilityRole="tablist">
        {([{key:'home',label:'Home',icon:'home-outline'},{key:'application',label:'My Application',icon:'checkbox-outline'},{key:'ai',label:'Chat',icon:'chatbubbles-outline'}] as const).map(item=><Pressable key={item.key} accessibilityRole="tab" accessibilityState={{selected:tab===item.key}} onPress={()=>selectTab(item.key)} style={({pressed})=>[styles.tab,tab===item.key&&styles.activeTab,pressed&&{opacity:.7}]}>
          <Ionicons name={item.icon} size={23} color={tab===item.key?colors.navy:colors.muted}/>
          <Text style={[styles.tabLabel,tab===item.key&&styles.activeLabel]}>{t(item.label)}</Text>
        </Pressable>)}
      </View>}
    </View>
  </SafeAreaView>;
}

function AccountShell() {
  const account = useAccount();
  const { t } = useLanguage();
  const [lastTab,setLastTab]=useState<Tab|undefined>();
  const visible = account.ready && !account.locked;
  return <View style={{flex:1}}>
    {/* Keep an old editor mounted but inaccessible while its writes drain. The
        scoped key remounts it only after the account boundary has committed. */}
    {account.scope !== undefined && <View style={[styles.panel,!visible&&styles.hidden]} accessibilityElementsHidden={!visible} importantForAccessibility={!visible?'no-hide-descendants':'auto'}><EagleApp key={account.scope} draftOwner={account.scope === 'guest' ? null : account.scope} initialTab={lastTab} onTabChange={setLastTab}/></View>}
    {!visible && <SafeAreaView style={styles.safe} edges={['top','bottom']}>
      <StatusBar style="dark" />
      <View style={styles.shell}>
        {account.deletionPending ? <AccountScreen /> : account.locked ? <AccountScreen locked /> : <View style={styles.loading}>
          {account.error ? <><Text accessibilityRole="alert" style={styles.error}>{t(account.error)}</Text><Button title={t('Try again')} onPress={account.retry}/>{account.recoverSignIn && <><Text style={styles.error}>{t('Sign in to the account with your unsaved draft to continue.')}</Text><Button title={t('Return to login')} variant="secondary" onPress={()=>void account.recoverSignIn?.()}/></>}</> : <><ActivityIndicator color={colors.navy}/><Text style={styles.error}>{t('Opening your account…')}</Text></>}
        </View>}
      </View>
    </SafeAreaView>}
  </View>;
}

export default function App() {return <SafeAreaProvider><LanguageProvider><AccountProvider><AccountShell/></AccountProvider></LanguageProvider></SafeAreaProvider>;}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:Platform.OS==='web'?'#E8EBF1':'#FFFFFF'},
  shell:{flex:1,width:'100%',maxWidth:600,alignSelf:'center',backgroundColor:colors.background},
  panel:{flex:1,minHeight:0,zIndex:1},hidden:{display:'none'},
  loading:{flex:1,alignItems:'center',justifyContent:'center',padding:24,gap:16},error:{color:colors.muted,fontSize:14,lineHeight:21,textAlign:'center'},
  tabs:{flexDirection:'row',backgroundColor:'#FFFFFF',borderTopWidth:1,borderTopColor:'#E1E5EE',paddingHorizontal:10,paddingVertical:8,gap:6},
  tab:{flex:1,minHeight:56,alignItems:'center',justifyContent:'center',gap:5,borderRadius:12},
  activeTab:{backgroundColor:colors.blueLight},tabLabel:{fontSize:11,color:colors.muted},activeLabel:{color:colors.navy,fontWeight:'700'},eagle:{width:29,height:31,resizeMode:'contain'},
});
