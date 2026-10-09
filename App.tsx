import React, { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import FormsFlow from './src/screens/FormsFlow';
import { AssistantScreen } from './src/screens/AssistantScreen';
import { ApplicationScreen } from './src/screens/ApplicationScreen';
import type { DraftSummary } from './src/types';

type Tab = 'home' | 'application' | 'ai';

function EagleApp() {
  const [tab,setTab]=useState<Tab>('home');
  const [contactRequest,setContactRequest]=useState(0);
  const [homeKey,setHomeKey]=useState(0);
  const [draft,setDraft]=useState<DraftSummary>();
  const openContact=()=>{setContactRequest(n=>n+1);setTab('ai');};
  return <SafeAreaView style={styles.safe} edges={['top','bottom']}>
    <StatusBar style="dark" />
    <View style={styles.shell}>
      <View style={[styles.panel,tab!=='home'&&styles.hidden]} accessibilityElementsHidden={tab!=='home'} importantForAccessibility={tab!=='home'?'no-hide-descendants':'auto'}><FormsFlow key={homeKey} isActive={tab==='home'} onContact={openContact} onDraftSaved={setDraft}/></View>
      <View style={[styles.panel,tab!=='application'&&styles.hidden]} accessibilityElementsHidden={tab!=='application'} importantForAccessibility={tab!=='application'?'no-hide-descendants':'auto'}><ApplicationScreen draft={draft} onResume={()=>setTab('home')} onStart={()=>{setDraft(undefined);setHomeKey(n=>n+1);setTab('home');}}/></View>
      <View style={[styles.panel,tab!=='ai'&&styles.hidden]} accessibilityElementsHidden={tab!=='ai'} importantForAccessibility={tab!=='ai'?'no-hide-descendants':'auto'}><AssistantScreen isActive={tab==='ai'} contactRequest={contactRequest}/></View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {([{key:'home',label:'Home',icon:'home-outline'},{key:'application',label:'My Application',icon:'checkbox-outline'},{key:'ai',label:'Eagle AI',icon:'sparkles-outline'}] as const).map(item=><Pressable key={item.key} accessibilityRole="tab" accessibilityState={{selected:tab===item.key}} onPress={()=>setTab(item.key)} style={({pressed})=>[styles.tab,tab===item.key&&styles.activeTab,pressed&&{opacity:.7}]}>
          {item.key==='ai'?<Image source={require('./assets/eagle-logo.png')} style={styles.eagle}/>:<Ionicons name={item.icon} size={23} color={tab===item.key?'#061B49':'#637089'}/>}
          <Text style={[styles.tabLabel,tab===item.key&&styles.activeLabel]}>{item.label}</Text>
        </Pressable>)}
      </View>
    </View>
  </SafeAreaView>;
}

export default function App() {return <SafeAreaProvider><EagleApp/></SafeAreaProvider>;}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:Platform.OS==='web'?'#E8EBF1':'#FFFFFF'},
  shell:{flex:1,width:'100%',maxWidth:600,alignSelf:'center',backgroundColor:'#F7F8FC'},
  panel:{flex:1,minHeight:0},hidden:{display:'none'},
  tabs:{flexDirection:'row',backgroundColor:'#FFFFFF',borderTopWidth:1,borderTopColor:'#E1E5EE',paddingHorizontal:10,paddingVertical:8,gap:6},
  tab:{flex:1,minHeight:56,alignItems:'center',justifyContent:'center',gap:5,borderRadius:12},
  activeTab:{backgroundColor:'#FCF7EB'},tabLabel:{fontSize:11,color:'#637089'},activeLabel:{color:'#061B49',fontWeight:'600'},eagle:{width:27,height:27,resizeMode:'contain'},
});
