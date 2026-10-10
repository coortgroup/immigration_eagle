import React from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius } from '../theme';

export function Button({ title, onPress, variant = 'primary', disabled, icon, style, accessibilityLabel }: {
  title: string; onPress: () => void; variant?: 'primary' | 'gold' | 'secondary' | 'quiet'; disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap; style?: ViewStyle; accessibilityLabel?: string;
}) {
  const foreground = variant === 'primary' ? colors.paper : colors.navy;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || title} accessibilityState={{ disabled: !!disabled }}
    onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.button, styles[variant], disabled && { opacity: 0.45 }, pressed && { opacity: 0.76 }, style]}>
    <Text style={[styles.buttonText, { color: foreground }]}>{title}</Text>
    {icon && <Ionicons name={icon} size={19} color={foreground} />}
  </Pressable>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Badge({ children, gold = false }: { children: React.ReactNode; gold?: boolean }) {
  return <View style={[styles.badge, gold && { backgroundColor: colors.goldLight }]}><Text style={styles.badgeText}>{children}</Text></View>;
}

export function SectionTitle({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return <View style={{ gap: 8 }}>
    {eyebrow && <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>}
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
  </View>;
}

export function Field({ label, help, error, multiline, ...props }: TextInputProps & { label: string; help?: string; error?: string }) {
  return <View style={{ gap: 8 }}>
    <Text style={styles.label}>{label}</Text>
    {help && <Text style={styles.help}>{help}</Text>}
    <TextInput accessibilityLabel={label} placeholderTextColor="#8B96A5" {...props} multiline={multiline}
      style={[styles.input, multiline && { minHeight: 116, textAlignVertical: 'top' }, error && { borderColor: colors.error }, props.style]} />
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}

export function BrandMark({ compact = false, width = 280 }: { compact?: boolean; width?: number }) {
  return <Image
    source={compact ? require('../../assets/eagle-logo.png') : require('../../assets/fillout-logo-v3.png')}
    style={compact ? styles.brandEmblem : [styles.brandWordmark, { width, height: width * 494 / 1200 }]}
    resizeMode="contain"
    accessibilityLabel="FILLOUT IMMIGRATION FORMS logo"
  />;
}

export function Notice({ children, tone = 'neutral', title }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning'; title?: string }) {
  return <View style={[styles.notice, { backgroundColor: tone === 'success' ? colors.successLight : tone === 'warning' ? colors.goldLight : '#EEF2F7' }]}>
    {title && <Text style={styles.label}>{title}</Text>}
    {typeof children === 'string' ? <Text style={styles.help}>{children}</Text> : children}
  </View>;
}

export function RowLink({ title, subtitle, onPress, icon = 'chevron-forward' }: { title: string; subtitle?: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#F1F4F8' }]}>
    <View style={{ flex: 1, gap: 5 }}><Text style={styles.label}>{title}</Text>{subtitle && <Text style={styles.help}>{subtitle}</Text>}</View>
    <Ionicons name={icon} size={19} color={colors.navy} />
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { minHeight: 50, borderRadius: radius.sm, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
  primary: { backgroundColor: colors.navy }, gold: { backgroundColor: colors.gold },
  secondary: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border }, quiet: { backgroundColor: 'transparent' },
  buttonText: { fontSize: 15, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  card: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 16, gap: 12 },
  badge: { backgroundColor: '#EDF1F7', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 9, alignSelf: 'flex-start' },
  badgeText: { color: colors.navy, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  eyebrow: { color: '#8E6E2B', fontWeight: '800', fontSize: 11, letterSpacing: 1.4 },
  title: { color: colors.navy, fontWeight: '800', fontSize: 28, lineHeight: 35, letterSpacing: -0.7 },
  subtitle: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  label: { color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  help: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  input: { minHeight: 52, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: 14, backgroundColor: colors.paper, color: colors.text, fontSize: 16 },
  error: { color: colors.error, fontSize: 13, lineHeight: 19 },
  brandEmblem: { width: 36, height: 40, flexShrink: 0 },
  brandWordmark: { aspectRatio: 1200 / 494, maxWidth: '100%', flexShrink: 1 },
  notice: { borderRadius: radius.sm, padding: 15, gap: 6 },
  row: { paddingVertical: 16, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', gap: 16 },
});
