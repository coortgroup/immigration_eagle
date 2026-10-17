import { useLanguage } from '../LanguageContext';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

export function AssistantWelcome() {
  const { t } = useLanguage();
  return <View style={styles.welcome}>
    <Image source={require('../../assets/eagle-logo.png')} style={styles.logo} accessibilityLabel="FillOut" />
    <Text accessibilityRole="header" style={styles.greeting}>{t('Message the FillOut team')}</Text>
    <Text style={styles.copy}>{t('Ask us about your forms or using the app. Our team will reply here.')}</Text>
  </View>;
}

const styles = StyleSheet.create({
  welcome: { flex: 1, minHeight: 210, alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 28, paddingHorizontal: 12 },
  logo: { width: 68, height: 76, resizeMode: 'contain' },
  greeting: { color: '#092653', fontSize: 25, lineHeight: 33, fontWeight: '700', textAlign: 'center' },
  copy: { color: '#5F6B7B', fontSize: 14, lineHeight: 22, textAlign: 'center', maxWidth: 320 },
});
