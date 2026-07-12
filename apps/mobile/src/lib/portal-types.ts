export type Overview = {
  lease: {
    id: string
    status: string
    startDate: string
    endDate: string | null
    dueDay: number
    depositCents: number
    unitLabel: string
    propertyName: string
    propertyAddress: string
    coTenants: string[]
    currentRentCents: number | null
  } | null
  balanceCents: number
  currentPeriod: { status: string; dueCents: number; paidCents: number } | null
  nextDueDate: string | null
  autopay: { enabled: boolean; lastRunPeriod: string | null; method: { id: string; brand: string; last4: string } } | null
  autopayRun: { status: string; amountCents?: number; receiptNumber?: string; message?: string } | null
  renewal: { endDate: string | null; daysRemaining: number | null; expiringSoon: boolean } | null
}

export type PaymentMethodDto = {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  isDefault: boolean
}
