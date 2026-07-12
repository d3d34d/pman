import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { Platform, Share, View } from 'react-native'
import { api } from '@/lib/api'
import { brandGlyph } from '@/lib/card'
import { fmtDate } from '@/lib/dates'
import { fmtMoney } from '@/lib/money'
import { colors } from '@/lib/theme'
import { Body, Button, Card, KeyValue, Loading, Muted, Screen, SectionHeader, Spacer } from '@/ui/kit'

type Receipt = {
  receipt: {
    id: string
    receiptNumber: string | null
    amountCents: number
    receivedDate: string
    method: string
    source: string
    reference: string | null
    providerRef: string | null
    card: { brand: string; last4: string } | null
    tenantName: string
    propertyName: string
    propertyAddress: string
    unitLabel: string
  }
}

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isLoading } = useQuery({ queryKey: ['receipt', id], queryFn: () => api<Receipt>(`/portal/receipts/${id}`) })

  if (isLoading || !data) return <Screen><Loading /></Screen>
  const r = data.receipt

  const text = [
    `PMAN rent receipt${r.receiptNumber ? ` — ${r.receiptNumber}` : ''}`,
    `Amount: ${fmtMoney(r.amountCents)}`,
    `Date: ${fmtDate(r.receivedDate)}`,
    `Tenant: ${r.tenantName}`,
    `Property: ${r.propertyName} · ${r.unitLabel}`,
    `${r.propertyAddress}`,
    r.card ? `Paid with: ${r.card.brand} ····${r.card.last4}` : `Method: ${r.method}`,
    r.providerRef ? `Reference: ${r.providerRef}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  async function share() {
    if (Platform.OS === 'web') {
      // Share isn't available on web; put it on the clipboard instead.
      await navigator.clipboard?.writeText(text)
      return
    }
    await Share.share({ message: text })
  }

  return (
    <Screen>
      <Card style={{ backgroundColor: colors.greenSoft, borderColor: 'transparent', alignItems: 'center', paddingVertical: 22 }}>
        <Muted small>Paid</Muted>
        <Body bold style={{ fontSize: 30, color: colors.green }}>{fmtMoney(r.amountCents)}</Body>
        {r.receiptNumber && <Muted small>{r.receiptNumber}</Muted>}
      </Card>

      <SectionHeader title="Details" />
      <Card>
        <KeyValue k="Date" v={fmtDate(r.receivedDate)} />
        <KeyValue k="Tenant" v={r.tenantName} />
        <KeyValue k="Property" v={`${r.propertyName} · ${r.unitLabel}`} />
        <KeyValue k="Address" v={r.propertyAddress} />
        <KeyValue k="Method" v={r.card ? `${brandGlyph(r.card.brand)} ····${r.card.last4}` : r.method} />
        {r.providerRef ? <KeyValue k="Reference" v={r.providerRef} /> : null}
      </Card>

      <Spacer h={6} />
      <Button title={Platform.OS === 'web' ? 'Copy receipt' : 'Share receipt'} variant="secondary" onPress={share} />
      <View style={{ marginTop: 4 }}>
        <Muted small>Keep this for your records.</Muted>
      </View>
    </Screen>
  )
}
