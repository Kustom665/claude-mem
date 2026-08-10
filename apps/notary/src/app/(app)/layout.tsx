import { requireUser } from '@/lib/auth';
import { MainNav } from '@/components/nav';
import { SignOutButton } from '@/components/sign-out-button';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-screen">
      <MainNav userName={user.name} signOut={<SignOutButton />} />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
