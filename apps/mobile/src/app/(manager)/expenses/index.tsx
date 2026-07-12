import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { fmtMoney } from '@/lib/money'
import { Body, Button, Card, EmptyState, ListRow, Loading, Muted, Row, Screen } from '@/ui/kit'

type Expenses = {
  expenses: {
    id: string
    category: string
    amountCents: number
    incurredOn: string
    description: string | null
    property: { id: string; name: string }
  }[]
  totalCents: number
}

const CATEGORY_LABEL: Record<string, string> = {
  REPAIRS: 'Repairs',
  UTILITIES: 'Utilities',
  TAXES: 'Taxes',
  INSURANCE: 'Insurance',
  MANAGEMENT: 'Management',
  OTHER: 'Other',
}

export default function ExpensesScreen() {
  const { data, isLoading } = useQuery({ queryKey: ['expenses'], queryFn: () => api<Expenses>('/expenses') })

  return (
    <Screen>
      <Row style={{ marginBottom: 12 }}>
        <Card style={{ flex: 1, marginBottom: 0, marginRight: 8 }}>
          <Muted small>Total recorded</Muted>
          <Body bold style={{ fontSize: 18 }}>{data ? fmtMoney(data.totalCents) : '—'}</Body>
        </Card>
        <Button title="+ Add expense" compact onPress={() => router.push('/expenses/new')} />
      </Row>

      {isLoading || !data ? (
        <Loading />
      ) : data.expenses.length === 0 ? (
        <EmptyState title="No expenses yet" hint="Track repairs, utilities, taxes and insurance per property." />
      ) : (
        data.expenses.map((e) => (
          <ListRow
            key={e.id}
            title={`${CATEGORY_LABEL[e.category] ?? e.category}${e.description ? ` — ${e.description}` : ''}`}
            subtitle={`${e.property.name} · ${fmtDate(e.incurredOn)}`}
            right={<Body bold>{fmtMoney(e.amountCents)}</Body>}
          />
        ))
      )}
    </Screen>
  )
}
