import React, { useEffect, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import FormsFlow from './src/screens/FormsFlow';
import { AssistantScreen } from './src/screens/AssistantScreen';
import { ApplicationScreen } from './src/screens/ApplicationScreen';
import type { DraftSummary } from './src/types';
import { deleteDraft, listDrafts } from './src/draftStorage';
import { colors } from './src/theme';

type Tab = 'home' | 'application' | 'ai';

function EagleApp() {
  const query = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : undefined;
  const [tab,setTab]=useState<Tab>(query?.get('screen') === 'contact' ? 'ai' : 'home');
  const [contactRequest,setContactRequest]=useState(query?.get('screen') === 'contact' ? 1 : 0);
  const [homeKey,setHomeKey]=useState(0);
  const [initialFormId,setInitialFormId]=useState(query?.get('form') || undefined);
  const [drafts,setDrafts]=useState<DraftSummary[]>([]);
  const [draftError,setDraftError]=useState('');
  const [draftsLoading,setDraftsLoading]=useState(true);
  const [resumeFormId,setResumeFormId]=useState<string>();
  const [resumeRequest,setResumeRequest]=useState(0);
  const refreshDrafts=async()=>{
    try { setDrafts(await listDrafts()); setDraftError(''); }
    catch(error) {setDraftError(error instanceof Error ? error.message : 'Could not load your saved drafts.');}
    finally {setDraftsLoading(false);}
  };
  useEffect(()=>{void refreshDrafts();},[]);
  const removeDraft=async(formId:string)=>{
    await deleteDraft(formId);
    await refreshDrafts();
    setInitialFormId(undefined); setResumeRequest(0); setResumeFormId(undefined); setHomeKey(n=>n+1);
  };
  const openContact=()=>{setContactRequest(n=>n+1);setTab('ai');};
  return <SafeAreaView style={styles.safe} edges={['top','bottom']}>
    <StatusBar style="dark" />
    <View style={styles.shell}>
      <View style={[styles.panel,tab!=='home'&&styles.hidden]} accessibilityElementsHidden={tab!=='home'} importantForAccessibility={tab!=='home'?'no-hide-descendants':'auto'}><FormsFlow key={homeKey} initialFormId={initialFormId} resumeFormId={resumeFormId} resumeRequest={resumeRequest} isActive={tab==='home'} onContact={openContact} onDraftSaved={()=>{void refreshDrafts();}}/></View>
      <View style={[styles.panel,tab!=='application'&&styles.hidden]} accessibilityElementsHidden={tab!=='application'} importantForAccessibility={tab!=='application'?'no-hide-descendants':'auto'}><ApplicationScreen drafts={drafts} loading={draftsLoading} error={draftError} onRetry={()=>{void refreshDrafts();}} onRemove={removeDraft} onResume={formId=>{setResumeFormId(formId);setResumeRequest(n=>n+1);setTab('home');}} onStart={()=>{setInitialFormId(undefined);setResumeRequest(0);setResumeFormId(undefined);setHomeKey(n=>n+1);setTab('home');}}/></View>
      <View style={[styles.panel,tab!=='ai'&&styles.hidden]} accessibilityElementsHidden={tab!=='ai'} importantForAccessibility={tab!=='ai'?'no-hide-descendants':'auto'}><AssistantScreen isActive={tab==='ai'} contactRequest={contactRequest}/></View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {([{key:'home',label:'Home',icon:'home-outline'},{key:'application',label:'My Application',icon:'checkbox-outline'},{key:'ai',label:'FILLOUT AI',icon:'sparkles-outline'}] as const).map(item=><Pressable key={item.key} accessibilityRole="tab" accessibilityState={{selected:tab===item.key}} onPress={()=>setTab(item.key)} style={({pressed})=>[styles.tab,tab===item.key&&styles.activeTab,pressed&&{opacity:.7}]}>
          {item.key==='ai'?<Image source={require('./assets/eagle-logo.png')} style={styles.eagle}/>:<Ionicons name={item.icon} size={23} color={tab===item.key?colors.navy:colors.muted}/>}
          <Text style={[styles.tabLabel,tab===item.key&&styles.activeLabel]}>{item.label}</Text>
        </Pressable>)}
      </View>
    </View>
  </SafeAreaView>;
}

export default function App() {return <SafeAreaProvider><EagleApp/></SafeAreaProvider>;}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:Platform.OS==='web'?'#E8EBF1':'#FFFFFF'},
  shell:{flex:1,width:'100%',maxWidth:600,alignSelf:'center',backgroundColor:colors.background},
  panel:{flex:1,minHeight:0},hidden:{display:'none'},
  tabs:{flexDirection:'row',backgroundColor:'#FFFFFF',borderTopWidth:1,borderTopColor:'#E1E5EE',paddingHorizontal:10,paddingVertical:8,gap:6},
  tab:{flex:1,minHeight:56,alignItems:'center',justifyContent:'center',gap:5,borderRadius:12},
  activeTab:{backgroundColor:colors.blueLight},tabLabel:{fontSize:11,color:colors.muted},activeLabel:{color:colors.navy,fontWeight:'700'},eagle:{width:29,height:31,resizeMode:'contain'},
});
