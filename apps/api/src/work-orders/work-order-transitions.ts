import { WorkOrderStatus } from '../generated/prisma/enums';

const { OPEN, ASSIGNED, IN_PROGRESS, COMPLETED } = WorkOrderStatus;

// The single source of truth for the lifecycle. Anything not listed is illegal.
const allowedTransitions: Record<WorkOrderStatus, readonly WorkOrderStatus[]> =
  {
    [OPEN]: [ASSIGNED],
    [ASSIGNED]: [IN_PROGRESS],
    [IN_PROGRESS]: [COMPLETED],
    [COMPLETED]: [],
  };

export function canTransition(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
): boolean {
  return allowedTransitions[from].includes(to);
}
