import { useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import { useState } from 'react'
import { Image, View } from 'react-native'
import { api, apiUpload } from '@/lib/api'
import { isDateStr, todayStr } from '@/lib/dates'
import { parseMoney } from '@/lib/money'
import { backOr } from '@/lib/nav'
import { Body, Button, Card, ErrorText, Field, Muted, Screen, Segment, Spacer } from '@/ui/kit'

const METHODS = ['ZELLE', 'BANK_TRANSFER', 'CASH', 'CHECK', 'OTHER'] as const

export default function SubmitPayment() {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<(typeof METHODS)[number]>('ZELLE')
  const [paidOn, setPaidOn] = useState(todayStr())
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [proof, setProof] = useState<{ uri: string; name: string; mimeType?: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function pickProof() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.7 })
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0]
      setProof({ uri: a.uri, name: a.fileName ?? 'payment.jpg', mimeType: a.mimeType ?? 'image/jpeg' })
    }
  }

  async function submit() {
    setError('')
    const amountCents = parseMoney(amount)
    if (amountCents === null || amountCents <= 0) return setError('Enter the amount you paid, e.g. 1750')
    if (!isDateStr(paidOn)) return setError('Date paid must be YYYY-MM-DD')

    setBusy(true)
    try {
      const res = await api<{ submission: { id: string } }>('/portal/payment-submissions', {
        method: 'POST',
        body: { amountCents, method, paidOn, reference: reference.trim() || undefined, note: note.trim() || undefined },
      })
      if (proof) {
        await apiUpload(`/portal/payment-submissions/${res.submission.id}/proof`, proof)
      }
      qc.invalidateQueries()
      backOr('/pay')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Muted>Enter what you paid and attach a screenshot of the transfer. Your manager reviews it and marks it paid.</Muted>
      <Spacer h={14} />

      <Field label="Amount paid" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="1750" />
      <Segment
        label="How you paid"
        options={METHODS}
        value={method}
        onChange={setMethod}
        labels={{ ZELLE: 'Zelle', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CHECK: 'Check', OTHER: 'Other' }}
      />
      <Field label="Date paid" value={paidOn} onChangeText={setPaidOn} placeholder="YYYY-MM-DD" autoCapitalize="none" />
      <Field label="Reference (optional)" value={reference} onChangeText={setReference} placeholder="Zelle confirmation #, check #…" />
      <Field label="Note to your manager (optional)" value={note} onChangeText={setNote} multiline placeholder="Anything they should know" />

      <Card>
        <Body bold>Screenshot / proof</Body>
        <Muted small>A picture of the transfer confirmation helps your manager approve it faster.</Muted>
        <Spacer h={8} />
        {proof ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Image source={{ uri: proof.uri }} style={{ width: 90, height: 90, borderRadius: 10 }} />
            <Button title="Replace" compact variant="secondary" onPress={pickProof} />
          </View>
        ) : (
          <Button title="+ Attach screenshot" variant="secondary" onPress={pickProof} />
        )}
      </Card>

      <ErrorText>{error}</ErrorText>
      <Button title="Submit for review" onPress={submit} loading={busy} disabled={!amount.trim()} />
      <Muted small>You’ll see it as “Pending” until your manager reviews it.</Muted>
    </Screen>
  )
}
