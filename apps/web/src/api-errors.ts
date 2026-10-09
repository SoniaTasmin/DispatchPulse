import type { IneligibilityReason } from './api';

// Shape of the API's error responses (NestJS): { statusCode, message, error, reasons? }.
interface ApiErrorBody {
  message: string | string[];
  reasons?: IneligibilityReason[];
}

export interface ApiError {
  status: number | 'NETWORK';
  messages: string[];
  reasons: IneligibilityReason[];
}

/** Turns whatever RTK Query rejected with into something the UI can show. */
export function toApiError(error: unknown): ApiError {
  if (!isFetchError(error)) {
    return { status: 'NETWORK', messages: ['Unexpected error.'], reasons: [] };
  }
  if (typeof error.status !== 'number') {
    return {
      status: 'NETWORK',
      messages: ['Cannot reach the DispatchPulse API. Is it running?'],
      reasons: [],
    };
  }
  if (!isApiErrorBody(error.data)) {
    return {
      status: error.status,
      messages: [`Request failed (HTTP ${error.status}).`],
      reasons: [],
    };
  }
  const { message, reasons = [] } = error.data;
  return {
    status: error.status,
    messages: Array.isArray(message) ? message : [message],
    reasons,
  };
}

/** One readable sentence for a failed lifecycle action, shown in a toast. */
export function errorToText(error: unknown, requiredSkill: string): string {
  const { status, messages, reasons } = toApiError(error);
  const reasonText = reasons
    .map((reason) => describeReason(reason, requiredSkill))
    .join(', ');
  const text = reasonText
    ? `${messages.join(' ')} (${reasonText})`
    : messages.join(' ');
  // Lifecycle mutations invalidate their data even on failure, so the page is refetching.
  return status === 409 ? `${text}. Showing the latest data.` : text;
}

function describeReason(
  reason: IneligibilityReason,
  requiredSkill: string,
): string {
  switch (reason) {
    case 'MISSING_SKILL':
      return `Missing skill ${requiredSkill}`;
    case 'NOT_AVAILABLE':
      return 'Not available';
    case 'DIFFERENT_CITY':
      return 'Works in a different city';
  }
}

function isFetchError(
  error: unknown,
): error is { status: number | string; data?: unknown } {
  return typeof error === 'object' && error !== null && 'status' in error;
}

function isApiErrorBody(data: unknown): data is ApiErrorBody {
  if (typeof data !== 'object' || data === null || !('message' in data)) {
    return false;
  }
  return typeof data.message === 'string' || Array.isArray(data.message);
}
