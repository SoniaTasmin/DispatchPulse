import { TechnicianStatus } from '../generated/prisma/enums';

export type IneligibilityReason =
  'MISSING_SKILL' | 'NOT_AVAILABLE' | 'DIFFERENT_CITY';

export interface EligibilityTechnician {
  status: TechnicianStatus;
  city: string;
  skillCodes: readonly string[];
}

export interface EligibilityWorkOrder {
  requiredSkillCode: string;
  city: string;
}

export interface Eligibility {
  eligible: boolean;
  reasons: IneligibilityReason[];
}

// Used both to list matches and to validate an assignment, so the rule exists once.
export function checkEligibility(
  technician: EligibilityTechnician,
  workOrder: EligibilityWorkOrder,
): Eligibility {
  const reasons: IneligibilityReason[] = [];
  if (!technician.skillCodes.includes(workOrder.requiredSkillCode)) {
    reasons.push('MISSING_SKILL');
  }
  if (technician.status !== TechnicianStatus.AVAILABLE) {
    reasons.push('NOT_AVAILABLE');
  }
  if (!sameCity(technician.city, workOrder.city)) {
    reasons.push('DIFFERENT_CITY');
  }
  return { eligible: reasons.length === 0, reasons };
}

function sameCity(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
