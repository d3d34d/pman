import { SignInForm } from '@/ui/sign-in'

export default function TenantLogin() {
  return (
    <SignInForm
      role="TENANT"
      heading="Tenant"
      blurb="Sign in to pay rent, view your lease and reach your manager."
      primaryAction={{ label: 'Have an invite code? Set up your account', href: '/invite' }}
      switchLabel="I’m a property manager instead"
      switchHref="/manager-login"
    />
  )
}
