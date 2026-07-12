import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { api } from '@/lib/api'
import { isDateStr, todayStr } from '@/lib/dates'
import { parseMoney } from '@/lib/money'
import { colors } from '@/lib/theme'
import { Button, Card, Chip, ErrorText, Field, Loading, Muted, Screen, SectionHeader, Segment, Body } from '@/ui/kit'

type Properties = { properties: { id: string; name: string }[] }
type PropertyDetail = { units: { id: string; label: string; occupied: boolean }[]; property: { name: string } }
type Tenants = { tenants: { id: string; fullName: string; activeLease: object | null }[] }

export default function NewLease() {
  const { unitId: presetUnitId } = useLocalSearchParams<{ unitId?: string }>()
  const qc = useQueryClient()

  const [propertyId, setPropertyId] = useState('')
  const [unitId, setUnitId] = useState(presetUnitId ?? '')
  const [tenantIds, setTenantIds] = useState<string[]>([])
  const [rent, setRent] = useState('')
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState('')
  const [status, setStatus] = useState<'ACTIVE' | 'MONTH_TO_MONTH'>('ACTIVE')
  const [dueDay, setDueDay] = useState('1')
  const [deposit, setDeposit] = useState('')
  const [graceDays, setGraceDays] = useState('5')
  const [lateFee, setLateFee] = useState('50')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const properties = useQuery({ queryKey: ['properties'], queryFn: () => api<Properties>('/properties'), enabled: !presetUnitId })
  const propertyDetail = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api<PropertyDetail>(`/properties/${propertyId}`),
    enabled: !!propertyId && !presetUnitId,
  })
  const tenants = useQuery({ queryKey: ['tenants', 'ACTIVE'], queryFn: () => api<Tenants>('/tenants?status=ACTIVE') })

  function toggleTenant(id: string) {
    setTenantIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }

  async function submit() {
    setError('')
    const rentCents = parseMoney(rent)
    if (rentCents === null || rentCents <= 0) return setError('Monthly rent must be a dollar amount, e.g. 1400')
    if (!isDateStr(startDate)) return setError('Start date must be YYYY-MM-DD')
    if (endDate && !isDateStr(endDate)) return setError('End date must be YYYY-MM-DD')
    const depositCents = deposit.trim() ? parseMoney(deposit) : 0
    if (depositCents === null) return setError('Deposit must be a dollar amount')
    const lateFeeCents = lateFee.trim() ? parseMoney(lateFee) : 0
    if (lateFeeCents === null) return setError('Late fee must be a dollar amount')

    setBusy(true)
    try {
      const res = await api<{ lease: { id: string } }>('/leases', {
        method: 'POST',
        body: {
          unitId,
          tenantIds,
          startDate,
          endDate: endDate || undefined,
          status,
          rentCents,
          dueDay: Number(dueDay) || 1,
          depositCents,
          graceDays: Number(graceDays) || 0,
          lateFeeCents,
        },
      })
      qc.invalidateQueries()
      router.replace(`/lease/${res.lease.id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen>
      {!presetUnitId && (
        <>
          <SectionHeader title="1 · Pick a unit" />
          {!properties.data ? (
            <Loading />
          ) : (
            <Segment
              options={properties.data.properties.map((p) => p.id) as unknown as readonly string[]}
              value={propertyId}
              onChange={(id) => {
                setPropertyId(id)
                setUnitId('')
              }}
              labels={Object.fromEntries(properties.data.properties.map((p) => [p.id, p.name]))}
            />
          )}
          {propertyId && propertyDetail.data && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {propertyDetail.data.units.map((u) => (
                <Pressable
                  key={u.id}
                  onPress={() => !u.occupied && setUnitId(u.id)}
                  style={{
                    borderWidth: 1,
                    borderColor: unitId === u.id ? colors.primary : colors.border,
                    backgroundColor: u.occupied ? colors.slateSoft : unitId === u.id ? colors.primarySoft : colors.card,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    opacity: u.occupied ? 0.5 : 1,
                  }}
                >
                  <Text style={{ fontWeight: '600', color: colors.text }}>{u.label}</Text>
                  {u.occupied && <Muted small>occupied</Muted>}
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}

      <SectionHeader title={presetUnitId ? '1 · Tenants on the lease' : '2 · Tenants on the lease'} />
      {!tenants.data ? (
        <Loading />
      ) : tenants.data.tenants.length === 0 ? (
        <Card>
          <Muted>No tenants yet.</Muted>
          <Button title="+ Add tenant first" compact variant="secondary" onPress={() => router.push('/tenant/new')} />
        </Card>
      ) : (
        <Card>
          {tenants.data.tenants.map((t) => {
            const selected = tenantIds.includes(t.id)
            return (
              <Pressable key={t.id} onPress={() => toggleTenant(t.id)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 }}>
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.primary : colors.card,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {selected && <Text style={{ color: colors.white, fontWeight: '800', fontSize: 13 }}>✓</Text>}
                </View>
                <Body>{t.fullName}</Body>
                {t.activeLease ? <Chip status="ACTIVE" label="Has lease" /> : null}
              </Pressable>
            )
          })}
        </Card>
      )}

      <SectionHeader title={presetUnitId ? '2 · Terms' : '3 · Terms'} />
      <Field label="Monthly rent" value={rent} onChangeText={setRent} keyboardType="decimal-pad" placeholder="1400" />
      <Segment label="Lease type" options={['ACTIVE', 'MONTH_TO_MONTH'] as const} value={status} onChange={setStatus} labels={{ ACTIVE: 'Fixed term', MONTH_TO_MONTH: 'Month-to-month' }} />
      <Field label="Start date" value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
      {status === 'ACTIVE' && <Field label="End date (optional)" value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />}
      <Field label="Rent due day of month" value={dueDay} onChangeText={setDueDay} keyboardType="number-pad" hint="1–28" />
      <Field label="Security deposit (optional)" value={deposit} onChangeText={setDeposit} keyboardType="decimal-pad" placeholder="1400" />
      <Field label="Grace period (days)" value={graceDays} onChangeText={setGraceDays} keyboardType="number-pad" hint="Days after the due date before rent counts as late." />
      <Field label="Late fee" value={lateFee} onChangeText={setLateFee} keyboardType="decimal-pad" hint="Applied automatically once rent is unpaid past the grace period. 0 disables late fees." />

      <ErrorText>{error}</ErrorText>
      <Button title="Create lease" onPress={submit} loading={busy} disabled={!unitId || tenantIds.length === 0 || !rent.trim()} />
    </Screen>
  )
}
