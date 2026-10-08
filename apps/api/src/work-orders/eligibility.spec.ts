import { TechnicianStatus } from '../generated/prisma/enums';
import { checkEligibility, EligibilityTechnician } from './eligibility';

const workOrder = { requiredSkillCode: 'NETWORKING', city: 'Dhaka' };
const eligibleTechnician: EligibilityTechnician = {
  status: TechnicianStatus.AVAILABLE,
  city: 'Dhaka',
  skillCodes: ['NETWORKING', 'PRINTER'],
};

describe('checkEligibility', () => {
  it.each([
    ['eligible', {}, []],
    ['city match ignores case and spaces', { city: ' dhaka ' }, []],
    ['missing skill', { skillCodes: ['PRINTER'] }, ['MISSING_SKILL']],
    ['busy', { status: TechnicianStatus.BUSY }, ['NOT_AVAILABLE']],
    ['off duty', { status: TechnicianStatus.OFF_DUTY }, ['NOT_AVAILABLE']],
    ['other city', { city: 'Chattogram' }, ['DIFFERENT_CITY']],
    [
      'every problem at once',
      { skillCodes: [], status: TechnicianStatus.BUSY, city: 'Chattogram' },
      ['MISSING_SKILL', 'NOT_AVAILABLE', 'DIFFERENT_CITY'],
    ],
  ])('%s', (_case, overrides, expectedReasons) => {
    const result = checkEligibility(
      { ...eligibleTechnician, ...overrides },
      workOrder,
    );
    expect(result).toEqual({
      eligible: expectedReasons.length === 0,
      reasons: expectedReasons,
    });
  });
});
