import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { api, downloadFile } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { fmtMoney } from '@/lib/money'
import { Body, Button, Chip, EmptyState, ErrorText, ListRow, Loading, Muted, Screen, SectionHeader } from '@/ui/kit'

type Receipts = {
  receipts: {
    id: string
    receiptNumber: string | null
    amountCents: number
    receivedDate: string
    method: string
    source: string
    reference: string | null
  }[]
}

const SOURCE_LABEL: Record<string, string> = { PORTAL: 'Paid in app', AUTOPAY: 'Autopay', MANUAL: 'Recorded by manager' }

export default function ReceiptsScreen() {
  const { data, isLoading } = useQuery({ queryKey: ['receipts'], queryFn: () => api<Receipts>('/portal/receipts') })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function downloadStatement() {
    setError('')
    setBusy(true)
    try {
      await downloadFile('/portal/statement.csv', 'statement.csv')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !data) return <Screen><Loading /></Screen>

  return (
    <Screen>
      <SectionHeader title="Statement" />
      <ListRow
        title={busy ? 'Preparing…' : 'Download full statement (CSV)'}
        subtitle="Every charge and payment on your lease"
        onPress={downloadStatement}
      />
      <ErrorText>{error}</ErrorText>

      <SectionHeader title="Payments" />
      {data.receipts.length === 0 ? (
        <EmptyState title="No payments yet" hint="Once you pay rent, receipts show up here." />
      ) : (
        data.receipts.map((r) => (
          <ListRow
            key={r.id}
            title={fmtMoney(r.amountCents)}
            subtitle={`${fmtDate(r.receivedDate)} · ${r.reference ?? r.method}${r.receiptNumber ? ` · ${r.receiptNumber}` : ''}`}
            right={<Chip status={r.source === 'MANUAL' ? 'UPCOMING' : 'PAID'} label={SOURCE_LABEL[r.source] ?? r.source} />}
            onPress={() => router.push(`/receipt/${r.id}`)}
          />
        ))
      )}
    </Screen>
  )
}
