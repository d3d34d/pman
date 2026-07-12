import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { api, downloadFile } from '@/lib/api'
import { currentPeriod, periodLabel } from '@/lib/dates'
import { fmtMoney } from '@/lib/money'
import { colors } from '@/lib/theme'
import { Body, Card, Chip, EmptyState, ErrorText, ListRow, Loading, MonthStepper, Muted, Row, Screen, SectionHeader } from '@/ui/kit'

type Income = {
  year: number
  properties: { property: { id: string; name: string }; incomeCents: number; expenseCents: number; netCents: number }[]
  totals: { incomeCents: number; expenseCents: number; netCents: number }
}

type Delinquency = {
  rows: { leaseId: string; propertyName: string; unitLabel: string; tenants: string; phone: string | null; balanceCents: number; oldestUnpaidPeriod: string | null; status: string }[]
  totalCents: number
}

export default function ReportsScreen() {
  const [year, setYear] = useState(new Date().getUTCFullYear())
  const [csvError, setCsvError] = useState('')
  const [busyCsv, setBusyCsv] = useState('')
  const income = useQuery({ queryKey: ['income', year], queryFn: () => api<Income>(`/reports/income?year=${year}`) })
  const delinquency = useQuery({ queryKey: ['delinquency'], queryFn: () => api<Delinquency>('/reports/delinquency') })

  async function exportCsv(key: string, path: string, filename: string) {
    setCsvError('')
    setBusyCsv(key)
    try {
      await downloadFile(path, filename)
    } catch (e) {
      setCsvError((e as Error).message)
    } finally {
      setBusyCsv('')
    }
  }

  return (
    <Screen>
      <SectionHeader title="Income vs expenses" />
      <MonthStepper label={String(year)} onPrev={() => setYear((y) => y - 1)} onNext={() => setYear((y) => y + 1)} />
      {!income.data ? (
        <Loading />
      ) : (
        <>
          <Card>
            <Row>
              <View>
                <Muted small>Income</Muted>
                <Body bold style={{ color: colors.green, fontSize: 17 }}>{fmtMoney(income.data.totals.incomeCents)}</Body>
              </View>
              <View>
                <Muted small>Expenses</Muted>
                <Body bold style={{ color: colors.red, fontSize: 17 }}>{fmtMoney(income.data.totals.expenseCents)}</Body>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Muted small>Net</Muted>
                <Body bold style={{ fontSize: 17 }}>{fmtMoney(income.data.totals.netCents)}</Body>
              </View>
            </Row>
          </Card>
          {income.data.properties.map((p) => (
            <ListRow
              key={p.property.id}
              title={p.property.name}
              subtitle={`in ${fmtMoney(p.incomeCents)} · out ${fmtMoney(p.expenseCents)}`}
              right={<Body bold style={{ color: p.netCents >= 0 ? colors.green : colors.red }}>{fmtMoney(p.netCents)}</Body>}
            />
          ))}
        </>
      )}

      <SectionHeader title="Delinquency" />
      {!delinquency.data ? (
        <Loading />
      ) : delinquency.data.rows.length === 0 ? (
        <EmptyState title="No outstanding balances 🎉" />
      ) : (
        <>
          <Card>
            <Row>
              <Muted>Total outstanding</Muted>
              <Body bold style={{ color: colors.red }}>{fmtMoney(delinquency.data.totalCents)}</Body>
            </Row>
          </Card>
          {delinquency.data.rows.map((r) => (
            <ListRow
              key={r.leaseId}
              title={r.tenants}
              subtitle={`${r.propertyName} · ${r.unitLabel}${r.oldestUnpaidPeriod ? ` · owes since ${periodLabel(r.oldestUnpaidPeriod)}` : ''}${r.phone ? ` · ${r.phone}` : ''}`}
              right={
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Body bold>{fmtMoney(r.balanceCents)}</Body>
                  <Chip status={r.status} />
                </View>
              }
              onPress={() => router.push(`/lease/${r.leaseId}`)}
            />
          ))}
        </>
      )}

      <SectionHeader title="Export CSV" />
      <ListRow
        title={`Rent roll — ${periodLabel(currentPeriod())}`}
        subtitle={busyCsv === 'roll' ? 'Preparing download…' : 'Every active lease this month with paid / unpaid status'}
        onPress={() =>
          exportCsv('roll', `/reports/rent-roll.csv?period=${currentPeriod()}`, `rent-roll-${currentPeriod()}.csv`)
        }
      />
      <ListRow
        title={`Income & expenses — ${year}`}
        subtitle={busyCsv === 'income' ? 'Preparing download…' : 'Monthly income vs expenses per property'}
        onPress={() => exportCsv('income', `/reports/income.csv?year=${year}`, `income-${year}.csv`)}
      />
      <ErrorText>{csvError}</ErrorText>
      <Muted small>Downloads are fetched with your login and saved to your device (or shared on mobile).</Muted>
    </Screen>
  )
}
