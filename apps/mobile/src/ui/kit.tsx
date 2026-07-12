import { useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, statusLabel, statusTone } from '@/lib/theme'

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={s.screenContent}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[s.screenContent, { flex: 1 }]}>{children}</View>
  )
  return <SafeAreaView style={s.screen} edges={['left', 'right', 'bottom']}>{body}</SafeAreaView>
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.row, style]}>{children}</View>
}

export function Spacer({ h = 12 }: { h?: number }) {
  return <View style={{ height: h }} />
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title}>{children}</Text>
}

export function Subtitle({ children }: { children: ReactNode }) {
  return <Text style={s.subtitle}>{children}</Text>
}

export function Body({ children, bold, style }: { children: ReactNode; bold?: boolean; style?: object }) {
  return <Text style={[s.body, bold && { fontWeight: '600' }, style]}>{children}</Text>
}

export function Muted({ children, small }: { children: ReactNode; small?: boolean }) {
  return <Text style={[s.muted, small && { fontSize: 12 }]}>{children}</Text>
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <Text style={s.error}>{children}</Text>
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <Row style={{ marginTop: 20, marginBottom: 8 }}>
      <Text style={s.sectionTitle}>{title}</Text>
      {action}
    </Row>
  )
}

export function KeyValue({ k, v }: { k: string; v: ReactNode }) {
  return (
    <Row style={{ paddingVertical: 5 }}>
      <Muted>{k}</Muted>
      {typeof v === 'string' || typeof v === 'number' ? <Body bold>{v}</Body> : v}
    </Row>
  )
}

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

export function Chip({ status, label }: { status: string; label?: string }) {
  const tone = statusTone[status] ?? { fg: colors.slate, bg: colors.slateSoft }
  return (
    <View style={[s.chip, { backgroundColor: tone.bg }]}>
      <Text style={[s.chipText, { color: tone.fg }]}>{label ?? statusLabel[status] ?? status}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  compact,
}: {
  title: string
  onPress: () => void
  variant?: ButtonVariant
  disabled?: boolean
  loading?: boolean
  compact?: boolean
}) {
  const off = disabled || loading
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        s.button,
        compact && s.buttonCompact,
        variant === 'primary' && { backgroundColor: colors.primary },
        variant === 'secondary' && { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
        variant === 'danger' && { backgroundColor: colors.redSoft },
        variant === 'ghost' && { backgroundColor: 'transparent' },
        (pressed || off) && { opacity: 0.6 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.white : colors.primary} />
      ) : (
        <Text
          style={[
            s.buttonText,
            compact && { fontSize: 13 },
            variant === 'primary' && { color: colors.white },
            variant === 'secondary' && { color: colors.text },
            variant === 'danger' && { color: colors.red },
            variant === 'ghost' && { color: colors.primary },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  )
}

/** Destructive confirm that works identically on web and native: first tap
 *  arms it, second tap fires. */
export function ConfirmButton({ title, onConfirm, variant = 'danger' }: { title: string; onConfirm: () => void; variant?: ButtonVariant }) {
  const [armed, setArmed] = useState(false)
  return (
    <Button
      title={armed ? `Tap again to confirm` : title}
      variant={variant}
      onPress={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
          setTimeout(() => setArmed(false), 3500)
        }
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  multiline,
  autoCapitalize,
  hint,
}: {
  label: string
  value: string
  onChangeText: (t: string) => void
  placeholder?: string
  keyboardType?: KeyboardTypeOptions
  secureTextEntry?: boolean
  multiline?: boolean
  autoCapitalize?: 'none' | 'sentences' | 'words'
  hint?: string
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={[s.input, multiline && { height: 88, textAlignVertical: 'top', paddingTop: 10 }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9AA7B2"
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        autoCapitalize={autoCapitalize ?? (secureTextEntry || keyboardType === 'email-address' ? 'none' : 'sentences')}
      />
      {hint ? <Muted small>{hint}</Muted> : null}
    </View>
  )
}

/** Horizontal option picker used for methods, categories, priorities, etc. */
export function Segment<T extends string>({
  label,
  options,
  value,
  onChange,
  labels,
}: {
  label?: string
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  labels?: Partial<Record<T, string>>
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={s.fieldLabel}>{label}</Text> : null}
      <View style={s.segmentWrap}>
        {options.map((opt) => {
          const active = opt === value
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              style={[s.segment, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
              <Text style={[s.segmentText, active && { color: colors.white }]}>
                {labels?.[opt] ?? statusLabel[opt] ?? opt}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Lists & states
// ---------------------------------------------------------------------------

export function ListRow({
  title,
  subtitle,
  right,
  onPress,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
  onPress?: () => void
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.listRow, pressed && { opacity: 0.7 }]}>
      <View style={{ flex: 1, marginRight: 10 }}>
        <Body bold>{title}</Body>
        {subtitle ? <Muted small>{subtitle}</Muted> : null}
      </View>
      {right}
      {onPress ? <Text style={s.chevron}>›</Text> : null}
    </Pressable>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
      <Body bold>{title}</Body>
      {hint ? (
        <View style={{ marginTop: 4 }}>
          <Muted small>{hint}</Muted>
        </View>
      ) : null}
    </Card>
  )
}

export function Loading() {
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center' }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  )
}

export function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  const toneColor = tone ? (statusTone[tone]?.fg ?? colors.text) : colors.text
  return (
    <Card style={s.statTile}>
      <Muted small>{label}</Muted>
      <Text style={[s.statValue, { color: toneColor }]}>{value}</Text>
      {sub ? <Muted small>{sub}</Muted> : null}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Month stepper (rent roll)
// ---------------------------------------------------------------------------

export function MonthStepper({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <Row style={{ marginBottom: 12 }}>
      <Pressable onPress={onPrev} style={s.stepperBtn}>
        <Text style={s.stepperArrow}>‹</Text>
      </Pressable>
      <Body bold style={{ fontSize: 17 }}>
        {label}
      </Body>
      <Pressable onPress={onNext} style={s.stepperBtn}>
        <Text style={s.stepperArrow}>›</Text>
      </Pressable>
    </Row>
  )
}

// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: 16, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: 4 },
  subtitle: { fontSize: 15, color: colors.subtext, marginBottom: 12 },
  body: { fontSize: 15, color: colors.text },
  muted: { fontSize: 14, color: colors.subtext },
  error: { color: colors.red, fontSize: 14, marginBottom: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.subtext, textTransform: 'uppercase', letterSpacing: 0.6 },
  chip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  chipText: { fontSize: 12, fontWeight: '700' },
  button: {
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  buttonCompact: { paddingVertical: 7, paddingHorizontal: 12, marginBottom: 0 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.subtext, marginBottom: 6 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 46,
    fontSize: 15,
    color: colors.text,
  },
  segmentWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segment: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.text },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 13,
    marginBottom: 8,
  },
  chevron: { fontSize: 22, color: colors.subtext, marginLeft: 6, marginTop: -2 },
  statTile: { flex: 1, minWidth: 150 },
  statValue: { fontSize: 22, fontWeight: '700', marginVertical: 2 },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperArrow: { fontSize: 22, color: colors.text, marginTop: -2 },
})
