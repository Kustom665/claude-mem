import type { Tone } from '@/components/ui';

/** Badge color for where a pursued source stands. */
export function pipelineTone(status: string): Tone {
  switch (status) {
    case 'APPLIED':
    case 'ONBOARDING':
      return 'info';
    case 'APPROVED':
    case 'ACTIVE':
      return 'success';
    case 'DECLINED':
      return 'danger';
    case 'DORMANT':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** Badge color for an inbound request. */
export function requestTone(status: string): Tone {
  switch (status) {
    case 'NEW':
      return 'warning';
    case 'CONTACTED':
      return 'info';
    case 'ACCEPTED':
      return 'success';
    case 'DECLINED':
    case 'SPAM':
      return 'neutral';
    default:
      return 'neutral';
  }
}
