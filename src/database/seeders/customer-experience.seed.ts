import { Transaction } from "sequelize";
import {
  FitnessGoal,
  MembershipStatus,
  OnboardingStatus,
  PlanStatus,
  PlanType,
  TrainingGoal,
} from "../../common/enums/domain.enums";
import { MediaFileModel } from "../../modules/membership/media-file.model";
import { MembershipFeatureModel } from "../../modules/membership/membership-feature.model";
import { MembershipIntentModel } from "../../modules/membership/membership-intent.model";
import { MembershipModel } from "../../modules/membership/membership.model";
import { MembershipPlanModel } from "../../modules/membership/membership-plan.model";
import { PlanFeatureModel } from "../../modules/membership/plan-feature.model";
import { AnthropometricProfileModel } from "../../modules/profiles/anthropometric-profile.model";
import { BodyMeasurementModel } from "../../modules/profiles/body-measurement.model";
import { OnboardingModel } from "../../modules/profiles/onboarding.model";
import { UserModel } from "../../modules/users/user.model";

const features = [
  {
    code: "EXERCISE_LIBRARY",
    name: "Biblioteca de ejercicios",
    description: "Acceso al catálogo completo de ejercicios.",
  },
  {
    code: "WORKOUT_TRACKING",
    name: "Seguimiento de entrenamientos",
    description: "Registro e historial de sesiones.",
  },
  {
    code: "GYM_ACCESS",
    name: "Acceso al gimnasio",
    description: "Ingreso a instalaciones según alcance del plan.",
  },
];

const planSeeds = [
  {
    code: "DEV-MONTHLY",
    name: "Plan mensual · Desarrollo",
    description: "Precio y contenido exclusivos para pruebas beta.",
    planType: PlanType.MONTHLY,
    durationDays: 30,
    priceAmount: 120,
    currency: "BOB",
    displayOrder: 1,
    imageCode: "membership-plan-basic-cover",
    benefits: [
      "Acceso al gimnasio",
      "Biblioteca de ejercicios",
      "Seguimiento de entrenamientos",
    ],
  },
  {
    code: "DEV-QUARTERLY",
    name: "Plan trimestral · Desarrollo",
    description: "Precio y contenido exclusivos para pruebas beta.",
    planType: PlanType.QUARTERLY,
    durationDays: 90,
    priceAmount: 320,
    currency: "BOB",
    displayOrder: 2,
    imageCode: "membership-plan-quarterly-cover",
    benefits: ["Todo el plan mensual", "Vigencia trimestral"],
  },
  {
    code: "DEV-ANNUAL",
    name: "Plan anual · Desarrollo",
    description: "Precio y contenido exclusivos para pruebas beta.",
    planType: PlanType.ANNUAL,
    durationDays: 365,
    priceAmount: 1100,
    currency: "BOB",
    displayOrder: 3,
    imageCode: "membership-plan-annual-cover",
    benefits: ["Todo el plan trimestral", "Vigencia anual"],
  },
];

const images = [
  {
    code: "membership-plan-basic-cover",
    name: "Portada plan mensual",
    sourceUrl:
      "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1200&q=80",
    altText: "Zona de entrenamiento con máquinas y pesas",
  },
  {
    code: "membership-plan-quarterly-cover",
    name: "Portada plan trimestral",
    sourceUrl:
      "https://images.unsplash.com/photo-1571902943202-507ec2618e8f?auto=format&fit=crop&w=1200&q=80",
    altText: "Área amplia de gimnasio para entrenamiento",
  },
  {
    code: "membership-plan-annual-cover",
    name: "Portada plan anual",
    sourceUrl:
      "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1200&q=80",
    altText: "Persona entrenando con equipo de gimnasio",
  },
];

function dateOffset(days: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function seedCustomerExperience(
  mode: "base" | "mock" | "all",
  transaction: Transaction,
) {
  for (const item of features) {
    const [feature] = await MembershipFeatureModel.findOrCreate({
      where: { code: item.code },
      defaults: { ...item, status: "ACTIVE" },
      transaction,
    });
    await feature.update(
      { name: item.name, description: item.description, status: "ACTIVE" },
      { transaction },
    );
  }
  if (mode === "base") return;

  const imageByCode = new Map<string, MediaFileModel>();
  for (const item of images) {
    const [image] = await MediaFileModel.findOrCreate({
      where: { code: item.code },
      defaults: {
        ...item,
        fileType: "IMAGE",
        mimeType: "image/jpeg",
        sourceType: "EXTERNAL",
        sourceName: "Unsplash",
        storageUrl: null,
        width: 1200,
        height: 800,
        license: "Unsplash License",
        attribution: "Photo from Unsplash; source retained in source_url.",
        status: "ACTIVE",
      },
      transaction,
    });
    await image.update(
      {
        name: item.name,
        sourceUrl: item.sourceUrl,
        altText: item.altText,
        status: "ACTIVE",
      },
      { transaction },
    );
    imageByCode.set(item.code, image);
  }

  const featureRows = await MembershipFeatureModel.findAll({
    where: { status: "ACTIVE" },
    transaction,
  });
  const plans = new Map<string, MembershipPlanModel>();
  for (const item of planSeeds) {
    const image = imageByCode.get(item.imageCode)!;
    const [plan] = await MembershipPlanModel.findOrCreate({
      where: { code: item.code },
      defaults: {
        code: item.code,
        name: item.name,
        description: item.description,
        planType: item.planType,
        durationDays: item.durationDays,
        reminderDays: [7, 3, 1, 0],
        status: PlanStatus.ACTIVE,
        priceAmount: item.priceAmount,
        currency: item.currency,
        imageFileId: image.id,
        benefits: item.benefits,
        displayOrder: item.displayOrder,
        availableNew: true,
        availableRenewal: true,
        availableExtension: true,
        metadata: { developmentOnly: true },
      },
      transaction,
    });
    await plan.update(
      {
        name: item.name,
        description: item.description,
        durationDays: item.durationDays,
        priceAmount: item.priceAmount,
        currency: item.currency,
        imageFileId: image.id,
        benefits: item.benefits,
        displayOrder: item.displayOrder,
        status: PlanStatus.ACTIVE,
      },
      { transaction },
    );
    for (const feature of featureRows)
      await PlanFeatureModel.findOrCreate({
        where: { planId: plan.id, featureId: feature.id },
        defaults: { planId: plan.id, featureId: feature.id },
        transaction,
      });
    plans.set(item.code, plan);
  }

  const scenarios = [
    {
      email: "new.mock@gymsheet.local",
      onboarding: OnboardingStatus.NOT_STARTED,
    },
    {
      email: "onboarding.mock@gymsheet.local",
      onboarding: OnboardingStatus.IN_PROGRESS,
    },
    {
      email: "active.mock@gymsheet.local",
      onboarding: OnboardingStatus.COMPLETED,
      membership: MembershipStatus.ACTIVE,
      ends: 60,
    },
    {
      email: "expiring.mock@gymsheet.local",
      onboarding: OnboardingStatus.COMPLETED,
      membership: MembershipStatus.ACTIVE,
      ends: 5,
    },
    {
      email: "expired.mock@gymsheet.local",
      onboarding: OnboardingStatus.COMPLETED,
      membership: MembershipStatus.EXPIRED,
      ends: -10,
    },
    {
      email: "pending.mock@gymsheet.local",
      onboarding: OnboardingStatus.COMPLETED,
      membership: MembershipStatus.EXPIRED,
      ends: -5,
      pending: true,
    },
  ];
  for (const scenario of scenarios) {
    const user = await UserModel.findOne({
      where: { email: scenario.email },
      transaction,
    });
    if (!user) continue;
    const complete = scenario.onboarding === OnboardingStatus.COMPLETED;
    const partial = scenario.onboarding === OnboardingStatus.IN_PROGRESS;
    const [onboarding] = await OnboardingModel.findOrCreate({
      where: { userId: user.id },
      defaults: {
        userId: user.id,
        status: scenario.onboarding,
        currentStep: complete ? 5 : partial ? 3 : 1,
        completedSteps: complete ? [1, 2, 3, 4, 5] : partial ? [1, 2] : [],
        version: 1,
        primaryGoal: complete || partial ? FitnessGoal.GAIN_MUSCLE : null,
        experienceLevel: complete ? "INTERMEDIATE" : null,
        weeklyFrequency: complete ? 4 : null,
        trainingLocation: complete ? "GYM" : null,
        availableEquipment: complete ? ["DUMBBELLS", "BARBELL"] : [],
        trainingPreferences: complete ? ["STRENGTH"] : [],
        physicalConsiderations: null,
        weightUnit: "KG",
        heightUnit: "CM",
        heightValue: complete || partial ? 175 : null,
        consentHealth: complete,
        consentData: complete,
        startedAt: partial || complete ? new Date() : null,
        completedAt: complete ? new Date() : null,
      },
      transaction,
    });
    await onboarding.update({ status: scenario.onboarding }, { transaction });
    if (complete || partial) {
      await BodyMeasurementModel.findOrCreate({
        where: { userId: user.id, idempotencyKey: "mock-initial-weight" },
        defaults: {
          userId: user.id,
          weight: 75,
          unit: "KG",
          measuredOn: dateOffset(-1),
          source: "ONBOARDING",
          createdByUserId: user.id,
          idempotencyKey: "mock-initial-weight",
        },
        transaction,
      });
    }
    if (complete)
      await AnthropometricProfileModel.findOrCreate({
        where: { userId: user.id },
        defaults: {
          userId: user.id,
          age: null,
          weightKg: 75,
          heightCm: 175,
          goal: TrainingGoal.HYPERTROPHY,
          measurementUpdatedAt: new Date(),
        },
        transaction,
      });
    if (scenario.membership) {
      const plan = plans.get("DEV-MONTHLY")!;
      const externalReference = `mock-${scenario.email}`;
      const startsOn = dateOffset(-30);
      const endsOn = dateOffset(scenario.ends);
      const [membership] = await MembershipModel.findOrCreate({
        where: { externalReference },
        defaults: {
          userId: user.id,
          planId: plan.id,
          startsOn,
          endsOn,
          status: scenario.membership,
          externalReference,
          notes: "Escenario exclusivo de desarrollo.",
          createdByUserId: user.id,
          metadata: { developmentOnly: true },
        },
        transaction,
      });
      await membership.update(
        { planId: plan.id, startsOn, endsOn, status: scenario.membership },
        { transaction },
      );
      if (scenario.pending)
        await MembershipIntentModel.findOrCreate({
          where: { userId: user.id, idempotencyKey: "mock-pending-renewal" },
          defaults: {
            userId: user.id,
            membershipId: membership.id,
            planId: plan.id,
            intentType: "RENEWAL",
            months: 1,
            status: "PENDING_PAYMENT",
            channel: "WHATSAPP",
            idempotencyKey: "mock-pending-renewal",
            correlationId: user.id,
            confirmedAt: null,
          },
          transaction,
        });
    }
  }
}
