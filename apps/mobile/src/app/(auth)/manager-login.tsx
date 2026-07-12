import { SignInForm } from '@/ui/sign-in'

export default function ManagerLogin() {
  return (
    <SignInForm
      role="MANAGER"
      heading="Property Manager"
      blurb="Sign in to manage your properties, leases and tenants."
      primaryAction={{ label: 'New here? Create a manager account', href: '/register' }}
      switchLabel="I’m a tenant instead"
      switchHref="/tenant-login"
    />
  )
}
