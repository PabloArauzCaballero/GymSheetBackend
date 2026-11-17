import { HttpStatus, Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AffiliationRequestsService } from '../affiliations/affiliation-requests.service';
import { AffiliationsRepository } from '../affiliations/affiliations.repository';
import { CreateOrderInput } from './business-orders.schemas';

/**
 * The SOCIO side of buying a gym membership (ADR-0026): «membresía de
 * gimnasio = afiliación SOCIO confirmada + suscripción activa». A buyer who
 * is (or asked to be) SOCIO of that gym buys as is; otherwise the checkout
 * brings the location and the CI digits and the REQUESTED affiliation is
 * created inside the order's transaction, with every rule of ADR-0025 (a
 * confirmed SOCIO elsewhere is `409 SOCIO_OF_ANOTHER_GYM` with the switch
 * action, a pending request elsewhere is `409 AFFILIATION_SOCIO_PENDING`).
 */
@Injectable()
export class CheckoutAffiliation {
  constructor(
    private readonly repository: AffiliationsRepository,
    private readonly requests: AffiliationRequestsService,
  ) {}

  lockPerson(userId: string, transaction: Transaction): Promise<void> {
    return this.repository.lockSubject({ type: 'PERSON', userId }, transaction);
  }

  async ensureSocio(actor: AuthenticatedUser, gymEntityId: string, input: CreateOrderInput['affiliation'], transaction: Transaction): Promise<void> {
    const subject = { type: 'PERSON', userId: actor.id } as const;
    const live = await this.repository.liveOf(subject, transaction);
    if (live.some((row) => row.kind === 'SOCIO' && row.gymEntityId === gymEntityId)) return;
    if (!input) {
      throw new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, 'AFFILIATION_REQUIRED', 'Para comprar esta membresía elige tu sede y escribe los últimos 3 dígitos de tu CI.', {
        gymEntityId,
      });
    }
    // The same rule as `POST /me/affiliations` (`@RequiresVerifiedEmail`): the gym only receives proven mailboxes.
    if (actor.emailVerified !== true) {
      throw new DomainException(HttpStatus.FORBIDDEN, 'EMAIL_VERIFICATION_REQUIRED', 'Confirma tu correo para usar las funciones sociales.');
    }
    await this.requests.requestInTransaction(
      subject,
      { gymEntityId, kind: 'SOCIO', locationId: input.locationId, ciLast3: input.ciLast3, switchGym: input.switchGym },
      transaction,
    );
  }
}
