'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui';
import { deleteFeeItemAction } from '../actions';

function Inner() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" disabled={pending} className="px-2 py-1 text-xs">
      {pending ? 'Removing…' : 'Remove'}
    </Button>
  );
}

export function DeleteFeeButton({ itemId }: { itemId: string }) {
  return (
    <form action={deleteFeeItemAction.bind(null, itemId)}>
      <Inner />
    </form>
  );
}
