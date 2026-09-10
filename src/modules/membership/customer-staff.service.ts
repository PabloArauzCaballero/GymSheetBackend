import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { UniqueConstraintError } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { EmploymentStatus, UserRole } from "../../common/enums/domain.enums";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { AccessCredentialRepository } from "../access-control/access-credential.repository";
import { FacilitiesRepository } from "../facilities/facilities.repository";
import { GymDomainEvent } from "../integration/domain-event.catalog";
import { DomainEventPublisher } from "../integration/domain-event.publisher";
import { NotificationRepository } from "../notifications/notification.repository";
import { UsersRepository } from "../users/users.repository";
import { mapCustomer, mapStaff } from "./membership.mapper";
import { MembershipRepository } from "./membership.repository";
import {
  CreateCustomerInput,
  CreateStaffInput,
  CreateStaffUserInput,
  StaffListInput,
  UpdateStaffStatusInput,
} from "./membership.schemas";

@Injectable()
export class CustomerStaffService {
  constructor(
    private readonly repository: MembershipRepository,
    private readonly usersRepository: UsersRepository,
    private readonly credentialsRepository: AccessCredentialRepository,
    private readonly notificationsRepository: NotificationRepository,
    private readonly facilitiesRepository: FacilitiesRepository,
    private readonly events: DomainEventPublisher,
    private readonly sequelize: Sequelize,
  ) {}

  async createCustomer(input: CreateCustomerInput, actorUserId: string) {
    const [passwordHash, pinHash] = await Promise.all([
      bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS),
      bcrypt.hash(input.accessPin, env.BCRYPT_SALT_ROUNDS),
    ]);

    try {
      const userId = await this.sequelize.transaction(async (transaction) => {
        if (await this.usersRepository.findByEmail(input.email, transaction)) {
          throw new ConflictException("Ya existe una cuenta con este correo.");
        }

        const user = await this.usersRepository.createClient(
          {
            email: input.email,
            passwordHash,
            fullName: input.fullName,
          },
          transaction,
        );
        const customer = await this.repository.createCustomer(
          {
            userId: user.id,
            customerNumber: input.customerNumber,
            phoneNumber: input.phoneNumber,
            externalReference: input.externalReference,
            notes: input.notes,
            metadata: input.metadata,
          },
          transaction,
        );
        const credential = await this.credentialsRepository.createPin(
          user.id,
          "INTERNAL_PIN",
          pinHash,
          transaction,
        );
        const preference =
          await this.notificationsRepository.createDefaultPreference(
            user.id,
            transaction,
          );

        await this.events.record(
          {
            eventName: GymDomainEvent.CUSTOMER_REGISTERED,
            aggregateType: "customer_profile",
            aggregateId: customer.id,
            deduplicationKey: `customer.registered:${user.id}`,
            actorUserId,
            payload: {
              userId: user.id,
              customerProfileId: customer.id,
              customerNumber: customer.customerNumber,
              pinCredentialId: credential.id,
              notificationPreferenceId: preference.id,
            },
          },
          transaction,
        );

        return user.id;
      });

      const profile = await this.repository.findCustomerByUserId(userId);
      if (!profile) throw new NotFoundException("Cliente no encontrado.");
      return mapCustomer(profile);
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(
          "El correo, número de cliente o referencia externa ya existe.",
        );
      }
      throw error;
    }
  }

  async listCustomers(page: number, pageSize: number, tenantScope: string | null) {
    const result = await this.repository.listCustomers(page, pageSize, tenantScope);
    return {
      items: result.rows.map(mapCustomer),
      page,
      pageSize,
      total: result.count,
      totalPages: Math.ceil(result.count / pageSize),
    };
  }

  async createStaff(actor: AuthenticatedUser, input: CreateStaffInput) {
    const actorUserId = actor.id;
    await this.validateBranchIds(input.branchIds, actor.tenantScope);
    await this.sequelize.transaction(async (transaction) => {
      const user = await this.usersRepository.findById(
        input.userId,
        transaction,
      );
      if (
        !user ||
        ![UserRole.ADMIN, UserRole.COACH, UserRole.FRONT_DESK].includes(
          user.role,
        )
      ) {
        throw new UnprocessableEntityException(
          "El usuario no tiene un rol laboral permitido.",
        );
      }
      if (await this.repository.findStaffByUserId(input.userId, transaction)) {
        throw new ConflictException("El usuario ya tiene un perfil laboral.");
      }

      const { branchIds, ...attributes } = input;
      const profile = await this.repository.createStaff(
        attributes,
        transaction,
      );
      await this.repository.replaceStaffScopes(
        profile.id,
        branchIds,
        transaction,
      );
      await this.events.record(
        {
          eventName: GymDomainEvent.STAFF_PROFILE_CREATED,
          aggregateType: "staff_profile",
          aggregateId: profile.id,
          deduplicationKey: `staff.profile-created:${profile.id}`,
          actorUserId,
          payload: {
            userId: input.userId,
            staffProfileId: profile.id,
            branchIds,
          },
        },
        transaction,
      );
    });

    const profile = await this.repository.findStaffByUserId(input.userId);
    if (!profile) throw new NotFoundException("Perfil laboral no encontrado.");
    return mapStaff(profile);
  }

  /**
   * Alta completa de una persona del equipo: cuenta con rol laboral, perfil,
   * alcance de sedes, preferencia de avisos y —si se indica— PIN de acceso.
   * Existe porque `createStaff` exige un `usuarioId` que ninguna ruta
   * administrativa podía emitir: registrar un entrenador obligaba a crear la
   * cuenta fuera del producto.
   */
  async createStaffUser(actor: AuthenticatedUser, input: CreateStaffUserInput) {
    const actorUserId = actor.id;
    await this.validateBranchIds(input.branchIds, actor.tenantScope);
    const [passwordHash, pinHash] = await Promise.all([
      bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS),
      input.accessPin
        ? bcrypt.hash(input.accessPin, env.BCRYPT_SALT_ROUNDS)
        : Promise.resolve(null),
    ]);

    try {
      const userId = await this.sequelize.transaction(async (transaction) => {
        if (await this.usersRepository.findByEmail(input.email, transaction)) {
          throw new ConflictException("Ya existe una cuenta con este correo.");
        }

        const user = await this.usersRepository.createStaffUser(
          {
            email: input.email,
            passwordHash,
            fullName: input.fullName,
            role: input.role,
            // El gimnasio se hereda de quien da el alta y no se pide en el
            // formulario: un administrador solo puede contratar para su propio
            // gimnasio, así que preguntárselo sería ofrecerle equivocarse. Sin
            // esto, el personal quedaba sin gimnasio mientras los socios sí lo
            // guardaban, y esa asimetría se notaba en cuanto alguien listaba
            // las cuentas de una marca.
            tenantId: actor.tenantId,
          },
          transaction,
        );
        const profile = await this.repository.createStaff(
          {
            userId: user.id,
            position: input.position,
            hiredOn: input.hiredOn,
            unlimitedAccess: input.unlimitedAccess,
            metadata: input.metadata,
          },
          transaction,
        );
        await this.repository.replaceStaffScopes(
          profile.id,
          input.branchIds,
          transaction,
        );
        if (pinHash) {
          await this.credentialsRepository.createPin(
            user.id,
            "INTERNAL_PIN",
            pinHash,
            transaction,
          );
        }
        await this.notificationsRepository.createDefaultPreference(
          user.id,
          transaction,
        );
        // Se emite el mismo evento v1 que el alta por `usuarioId`: los
        // consumidores no distinguen cómo se creó la cuenta, y ampliar el
        // payload rompería el contrato publicado.
        await this.events.record(
          {
            eventName: GymDomainEvent.STAFF_PROFILE_CREATED,
            aggregateType: "staff_profile",
            aggregateId: profile.id,
            deduplicationKey: `staff.profile-created:${profile.id}`,
            actorUserId,
            payload: {
              userId: user.id,
              staffProfileId: profile.id,
              branchIds: input.branchIds,
            },
          },
          transaction,
        );

        return user.id;
      });

      const profile = await this.repository.findStaffByUserId(userId);
      if (!profile) throw new NotFoundException("Perfil laboral no encontrado.");
      return mapStaff(profile);
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException("El correo ya está registrado.");
      }
      throw error;
    }
  }

  async listStaff(input: StaffListInput, tenantScope: string | null) {
    const result = await this.repository.listStaff(input.page, input.pageSize, tenantScope, {
      ...(input.cargo ? { position: input.cargo } : {}),
      ...(input.estadoLaboral ? { employmentStatus: input.estadoLaboral } : {}),
    });
    return {
      items: result.rows.map(mapStaff),
      page: input.page,
      pageSize: input.pageSize,
      total: result.count,
      totalPages: Math.ceil(result.count / input.pageSize),
    };
  }

  async updateStaffStatus(
    userId: string,
    input: UpdateStaffStatusInput,
    actorUserId: string,
  ) {
    await this.sequelize.transaction(async (transaction) => {
      const profile = await this.repository.findStaffByUserId(
        userId,
        transaction,
      );
      if (!profile)
        throw new NotFoundException("Perfil laboral no encontrado.");
      if (
        input.employmentStatus === EmploymentStatus.TERMINATED &&
        !input.terminatedOn
      ) {
        throw new UnprocessableEntityException(
          "La fecha de terminación es obligatoria.",
        );
      }

      const fromStatus = profile.employmentStatus;
      await profile.update(input, { transaction });
      if (fromStatus === input.employmentStatus) return;

      await this.events.record(
        {
          eventName: GymDomainEvent.STAFF_STATUS_CHANGED,
          aggregateType: "staff_profile",
          aggregateId: profile.id,
          deduplicationKey: `staff.status-changed:${profile.id}:${randomUUID()}`,
          actorUserId,
          payload: {
            userId,
            staffProfileId: profile.id,
            fromStatus,
            toStatus: input.employmentStatus,
          },
        },
        transaction,
      );
    });

    const profile = await this.repository.findStaffByUserId(userId);
    if (!profile) throw new NotFoundException("Perfil laboral no encontrado.");
    return mapStaff(profile);
  }

  /**
   * Una sede de otro gimnasio se trata como inexistente: sin esto, el alcance
   * de un empleado era la vía para darle acceso a las sedes del vecino.
   */
  private async validateBranchIds(
    branchIds: string[],
    tenantScope: string | null,
  ) {
    for (const branchId of branchIds) {
      if (!(await this.facilitiesRepository.findBranch(branchId, tenantScope))) {
        throw new UnprocessableEntityException("Una sede asignada no existe.");
      }
    }
  }
}
