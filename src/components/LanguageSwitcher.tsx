import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLanguage } from '../LanguageContext';
import { colors, radius } from '../theme';

export function LanguageSwitcher() {
  const { language, setLanguage, t, languageError } = useLanguage();
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Choose language')} accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} style={styles.trigger}>
      <Ionicons name="globe-outline" size={23} color={colors.navy} /><Text style={styles.code}>{language.toUpperCase()}</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={t('Close language selection')} onPress={() => setOpen(false)} />
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text accessibilityRole="header" style={styles.title}>{t('Language')}</Text>
          {([{ code: 'en', label: 'English' }, { code: 'ru', label: 'Русский' }] as const).map(option => <Pressable key={option.code} accessibilityRole="radio" accessibilityState={{ checked: language === option.code }} onPress={() => { setLanguage(option.code); setOpen(false); }} style={[styles.option, language === option.code && styles.selected]}>
            <Text style={styles.label}>{option.label}</Text><Ionicons name={language === option.code ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={colors.navy} />
          </Pressable>)}
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.close}><Text style={styles.label}>{t('Close')}</Text></Pressable>
        </View>
      </View>
    </Modal>
    {!!languageError && <Text accessibilityRole="alert" style={styles.error}>{t(languageError)}</Text>}
  </>;
}
const styles = StyleSheet.create({
  trigger: { minWidth: 52, minHeight: 48, gap: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.paper },
  code: { fontSize: 9, fontWeight: '700', color: colors.navy },
  overlay: { flex: 1, backgroundColor: '#071B3A66', padding: 24, alignItems: 'center', justifyContent: 'center' },
  sheet: { width: '100%', maxWidth: 360, padding: 22, backgroundColor: colors.paper, borderRadius: radius.md, gap: 12 },
  title: { color: colors.navy, fontSize: 22, fontWeight: '700', marginBottom: 4 },
  option: { minHeight: 54, paddingHorizontal: 16, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selected: { backgroundColor: colors.blueLight, borderColor: colors.navy }, label: { color: colors.navy, fontSize: 16, fontWeight: '600' },
  close: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, error: { color: colors.error, fontSize: 12, maxWidth: 220 },
});
