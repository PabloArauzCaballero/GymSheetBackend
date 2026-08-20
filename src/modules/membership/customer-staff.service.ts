import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import { UniqueConstraintError } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { EmploymentStatus, UserRole } from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import { AccessCredentialRepository } from "../access-control/access-credential.repository";
import { FacilitiesRepository } from "../facilities/facilities.repository";
import { GymDomainEvent } from "../integration/domain-event.catalog";
import { DomainEventPublisher } from "../integration/domain-event.publisher";
import { NotificationChannel } from "../../common/enums/domain.enums";
import { NotificationRepository } from "../notifications/notification.repository";
import { NotificationService } from "../notifications/notification.service";
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

/**
 * Contraseña temporal para un alta hecha por recepción.
 *
 * Legible en voz alta y por teléfono: sin caracteres que se confundan al
 * dictarlos —ni O contra 0, ni l contra 1— porque la persona va a recibirla en
 * un correo y teclearla en el móvil. La longitud compensa el alfabeto reducido.
 *
 * Es temporal en el sentido de que el correo pide cambiarla, no en el de que
 * caduque: forzar el cambio en el primer acceso dejaría fuera a quien entra por
 * el torniquete antes que por la aplicación.
 */
function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(14);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

@Injectable()
export class CustomerStaffService {
  constructor(
    private readonly repository: MembershipRepository,
    private readonly usersRepository: UsersRepository,
    private readonly credentialsRepository: AccessCredentialRepository,
    private readonly notificationsRepository: NotificationRepository,
    private readonly notifications: NotificationService,
    private readonly facilitiesRepository: FacilitiesRepository,
    private readonly events: DomainEventPublisher,
    private readonly sequelize: Sequelize,
  ) {}

  async createCustomer(input: CreateCustomerInput, actorUserId: string) {
    // La contraseña se genera aquí cuando el alta no trae una, y sólo existe en
    // memoria el tiempo que tarda en enviarse por correo: no se devuelve en la
    // respuesta ni se registra. Que la vea recepción en pantalla sería peor que
    // no tenerla, porque acaba anotada en un papel junto al mostrador.
    const generatedPassword = input.password ?? generateTemporaryPassword();
    const [passwordHash, pinHash] = await Promise.all([
      bcrypt.hash(generatedPassword, env.BCRYPT_SALT_ROUNDS),
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

      // Fuera de la transacción: el alta no debe deshacerse porque el correo
      // falle. Si no llega, la persona siempre puede recuperar su contraseña
      // desde la aplicación, y ese camino ya existe.
      await this.notifications.enqueueDirectMessage({
        recipientUserId: userId,
        channel: NotificationChannel.EMAIL,
        subject: "Tu cuenta de GymSheet ya está lista",
        body: [
          `Hola ${input.fullName},`,
          "",
          "Tu gimnasio te creó una cuenta. Entra con estos datos:",
          "",
          `Correo:      ${input.email}`,
          `Contraseña:  ${generatedPassword}`,
          "",
          "Cámbiala en cuanto entres: esta contraseña la generamos nosotros y",
          "viajó por correo, así que no debería ser la que uses a diario.",
          "",
          "Puedes cambiarla desde «¿Olvidaste tu contraseña?» en la pantalla de acceso.",
        ].join("\n"),
        deduplicationKey: `welcome-${userId}`,
      });

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

  async listCustomers(page: number, pageSize: number) {
    const result = await this.repository.listCustomers(page, pageSize);
    return {
      items: result.rows.map(mapCustomer),
      page,
      pageSize,
      total: result.count,
      totalPages: Math.ceil(result.count / pageSize),
    };
  }

  async createStaff(input: CreateStaffInput, actorUserId: string) {
    await this.validateBranchIds(input.branchIds);
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
  async createStaffUser(input: CreateStaffUserInput, actorUserId: string) {
    await this.validateBranchIds(input.branchIds);
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

  async listStaff(input: StaffListInput) {
    const result = await this.repository.listStaff(input.page, input.pageSize, {
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

  private async validateBranchIds(branchIds: string[]) {
    for (const branchId of branchIds) {
      if (!(await this.facilitiesRepository.findBranch(branchId))) {
        throw new UnprocessableEntityException("Una sede asignada no existe.");
      }
    }
  }
}
