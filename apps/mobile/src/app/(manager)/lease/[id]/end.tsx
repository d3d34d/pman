import { useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { isDateStr, todayStr } from '@/lib/dates'
import { Button, ConfirmButton, ErrorText, Field, Muted, Screen, Spacer } from '@/ui/kit'

export default function EndLease() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()
  const [endDate, setEndDate] = useState(todayStr())
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    if (!isDateStr(endDate)) return setError('End date must be YYYY-MM-DD')
    try {
      await api(`/leases/${id}/end`, { method: 'POST', body: { endDate } })
      qc.invalidateQueries()
      router.back()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Screen>
      <Muted>
        Ending a lease stops future rent charges after the end month and frees the unit for a new lease. The ledger and
        payment history are kept, and any unpaid balance stays visible in the delinquency report.
      </Muted>
      <Spacer h={16} />
      <Field label="End date" value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" autoCapitalize="none" hint="The final month is still billed in full (no proration)." />
      <ErrorText>{error}</ErrorText>
      <ConfirmButton title="End this lease" onConfirm={submit} />
      <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
    </Screen>
  )
}
