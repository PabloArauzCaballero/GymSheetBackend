import { FitnessGoal } from '../../common/enums/domain.enums';
import { bodyMeasurementSchema, onboardingGoalsSchema, onboardingPreferencesSchema } from './onboarding.schemas';

describe('onboarding schemas', () => {
  it('accepts every supported goal as a stable enum', () => {
    for (const primaryGoal of Object.values(FitnessGoal)) {
      expect(onboardingGoalsSchema.parse({ primaryGoal })).toEqual({ primaryGoal });
    }
  });

  it('requires the two personalization consents to be explicit booleans', () => {
    expect(() => onboardingPreferencesSchema.parse({ experienceLevel: 'BEGINNER', weeklyFrequency: 3, trainingLocation: 'GYM', trainingPreferences: [] })).toThrow();
  });

  it('validates historical measurement units and dates', () => {
    expect(bodyMeasurementSchema.parse({ weight: 80, unit: 'KG', measuredOn: '2026-07-22' })).toMatchObject({ weight: 80, unit: 'KG' });
    expect(() => bodyMeasurementSchema.parse({ weight: -1, unit: 'KG', measuredOn: 'bad-date' })).toThrow();
  });
});
