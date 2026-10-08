import {
  WORK_ORDER_STATUSES,
  type TechnicianStatus,
  type WorkOrderStatus,
} from './api';

export const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

export const TECHNICIAN_STATUS_LABELS: Record<TechnicianStatus, string> = {
  AVAILABLE: 'Available',
  BUSY: 'Busy',
  OFF_DUTY: 'Off duty',
};

/** Returns the status if the value is a known one (e.g. from the URL), else undefined. */
export function parseStatus(value: string | null): WorkOrderStatus | undefined {
  return WORK_ORDER_STATUSES.find((status) => status === value);
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}
