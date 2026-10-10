import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

export function AssistantWelcome() {
  return <View style={styles.welcome}>
    <Image source={require('../../assets/eagle-logo.png')} style={styles.logo} accessibilityLabel="FILLOUT eagle" />
    <Text accessibilityRole="header" style={styles.greeting}>Hi, can I help you?</Text>
  </View>;
}

const styles = StyleSheet.create({
  welcome: { flex: 1, minHeight: 210, alignItems: 'center', justifyContent: 'center', gap: 22, paddingVertical: 32 },
  logo: { width: 76, height: 84, resizeMode: 'contain' },
  greeting: { color: '#092653', fontSize: 27, lineHeight: 35, fontWeight: '700', textAlign: 'center' },
});
