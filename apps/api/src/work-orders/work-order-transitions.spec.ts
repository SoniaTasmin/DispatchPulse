import { WorkOrderStatus } from '../generated/prisma/enums';
import { canTransition } from './work-order-transitions';

const { OPEN, ASSIGNED, IN_PROGRESS, COMPLETED } = WorkOrderStatus;
const allStatuses = [OPEN, ASSIGNED, IN_PROGRESS, COMPLETED];
const legal: Array<[WorkOrderStatus, WorkOrderStatus]> = [
  [OPEN, ASSIGNED],
  [ASSIGNED, IN_PROGRESS],
  [IN_PROGRESS, COMPLETED],
];

describe('canTransition', () => {
  it('allows legal transitions and rejects every other pair', () => {
    for (const from of allStatuses) {
      for (const to of allStatuses) {
        const expected = legal.some(([f, t]) => f === from && t === to);
        expect({ from, to, allowed: canTransition(from, to) }).toEqual({
          from,
          to,
          allowed: expected,
        });
      }
    }
  });
});
