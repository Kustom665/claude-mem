'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui';
import {
  retryDeliveryAction,
  rotateWebhookSecretAction,
  sendTestWebhookAction,
} from '../actions';

function Pending({
  idle,
  busy,
  variant = 'secondary',
  disabled,
  className,
}: {
  idle: string;
  busy: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending || disabled} className={className}>
      {pending ? busy : idle}
    </Button>
  );
}

export function TestWebhookButton({ disabled }: { disabled?: boolean }) {
  return (
    <form action={sendTestWebhookAction}>
      <Pending idle="Send test event" busy="Sending…" variant="primary" disabled={disabled} />
    </form>
  );
}

export function RotateSecretButton() {
  return (
    <form action={rotateWebhookSecretAction}>
      <Pending idle="Rotate secret" busy="Rotating…" variant="ghost" />
    </form>
  );
}

export function RetryDeliveryButton({ deliveryId }: { deliveryId: string }) {
  return (
    <form action={retryDeliveryAction.bind(null, deliveryId)}>
      <Pending idle="Retry" busy="Retrying…" variant="ghost" className="px-2 py-1 text-xs" />
    </form>
  );
}
