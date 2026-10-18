'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui';
import { signOutEverywhereAction } from './actions';

function Inner() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" disabled={pending}>
      {pending ? 'Revoking…' : 'Sign out everywhere'}
    </Button>
  );
}

export function SignOutEverywhereButton() {
  return (
    <form action={signOutEverywhereAction}>
      <Inner />
    </form>
  );
}
