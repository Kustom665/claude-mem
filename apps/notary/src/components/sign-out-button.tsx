import { signOutAction } from '@/app/(app)/actions';
import { Button } from './ui';

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost">
        Sign out
      </Button>
    </form>
  );
}
