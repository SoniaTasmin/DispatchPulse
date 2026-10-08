import type { WorkOrderStatus } from '../api';
import { STATUS_LABELS } from '../format';

// The label is always visible text; colour only reinforces it.
export function StatusBadge({ status }: { status: WorkOrderStatus }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
