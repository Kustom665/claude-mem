'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui';
import { deleteMileageAction } from '../actions';

function Inner() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" disabled={pending} className="px-2 py-1 text-xs">
      {pending ? 'Removing…' : 'Remove'}
    </Button>
  );
}

export function DeleteMileageButton({ entryId }: { entryId: string }) {
  return (
    <form action={deleteMileageAction.bind(null, entryId)}>
      <Inner />
    </form>
  );
}
