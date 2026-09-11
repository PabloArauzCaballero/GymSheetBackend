import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { randomBytes, createHash } from 'node:crypto';
import { env } from '../../config/env';
import { UsersRepository } from '../users/users.repository';
import { MembershipService } from './membership.service';
import { MembershipActivationRequestModel } from './membership-activation-request.model';

/**
 * Activación de cuentas para quien pagó fuera de la aplicación.
 *
 * El problema real: alguien paga en efectivo en recepción y la app no se
 * entera, así que al día siguiente le corta el acceso a la persona que acaba de
 * pagar. Hasta ahora la única salida era que un administrador buscara la cuenta
 * a mano, y mientras tanto el cliente se queda fuera.
 *
 * El recorrido es el corto: la persona pulsa un botón en su teléfono, se abre
 * WhatsApp con un mensaje ya escrito hacia el gimnasio y un enlace dentro. El
 * administrador abre ese enlace, elige el plan y confirma. Nadie busca a nadie.
 *
 * Dos decisiones de seguridad que sostienen todo lo demás:
 *
 * **El enlace no es la autorización.** Abrirlo no activa nada por sí solo:
 * identifica *a quién* activar. Quien confirma tiene que ser un administrador
 * con sesión, y esa comprobación vive en el guard del endpoint, no aquí. Si el
 * enlace se reenvía a un grupo de WhatsApp, quien lo abra sin permiso no puede
 * hacer nada con él.
 *
 * **El token se guarda hasheado.** Con SHA-256 y no bcrypt: es un valor
 * aleatorio de 32 bytes, no una contraseña que alguien pueda adivinar, así que
 * lo que hace falta es que no sea legible en la tabla, no resistencia a fuerza
 * bruta. Un hash lento aquí sólo añadiría latencia.
 */
@Injectable()
export class MembershipActivationService {
  constructor(
    @InjectModel(MembershipActivationRequestModel)
    private readonly requests: typeof MembershipActivationRequestModel,
    private readonly users: UsersRepository,
    private readonly memberships: MembershipService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Crea la petición y devuelve el enlace que el cliente enviará al gimnasio.
   *
   * Cada llamada invalida las anteriores de esa persona: si alguien pulsa el
   * botón tres veces, no deben quedar tres enlaces vivos capaces de activar la
   * misma cuenta.
   */
  async request(
    userId: string,
    nota: string | null,
  ): Promise<{ token: string; url: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiraEn = new Date(Date.now() + env.ACTIVATION_LINK_TTL_HOURS * 3_600_000);

    await this.requests.update(
      { consumidoEn: new Date(), consumidoPorUserId: userId },
      { where: { usuarioId: userId, consumidoEn: null } },
    );
    await this.requests.create({
      usuarioId: userId,
      tokenHash: this.hash(token),
      expiraEn,
      consumidoEn: null,
      consumidoPorUserId: null,
      nota,
    });

    return {
      token,
      url: `${env.PORTAL_PUBLIC_URL}/activar/${token}`,
      expiresAt: expiraEn,
    };
  }

  /** Datos de la petición, para que el administrador sepa a quién va a activar. */
  async describe(token: string) {
    const request = await this.findLive(token);
    const user = await this.users.findById(request.usuarioId);
    if (!user) throw new NotFoundException('La cuenta ya no existe.');
    return {
      requestId: request.id,
      solicitadoEl: request.get('createdAt') as Date,
      expiraEn: request.expiraEn,
      nota: request.nota,
      usuario: {
        id: user.id,
        email: user.email,
        nombreCompleto: user.fullName,
      },
    };
  }

  /**
   * Confirma la activación con el plan que el administrador eligió.
   *
   * Se apoya en `createMembership`, que ya valida el plan, registra el evento de
   * dominio y escribe el historial. Duplicar eso aquí habría creado una segunda
   * forma de dar de alta una membresía, y con ella una segunda forma de que el
   * historial quede incompleto.
   */
  async confirm(token: string, planId: string, adminUserId: string) {
    const request = await this.findLive(token);
    const membership = await this.memberships.createMembership(
      {
        userId: request.usuarioId,
        planId,
        // Sin fecha de inicio: `createMembership` toma hoy, que es cuando la
        // persona pagó y cuando quiere poder entrar.
        startsOn: undefined,
        externalReference: null,
        notes: 'Activación por pago fuera de la aplicación.',
        metadata: { origen: 'PAGO_FUERA_DE_APP', solicitudId: request.id },
      },
      adminUserId,
    );
    await request.update({
      consumidoEn: new Date(),
      consumidoPorUserId: adminUserId,
    });
    return membership;
  }

  private async findLive(token: string): Promise<MembershipActivationRequestModel> {
    const request = await this.requests.findOne({
      where: {
        tokenHash: this.hash(token),
        consumidoEn: null,
        expiraEn: { [Op.gt]: new Date() },
      },
    });
    // El mismo error para un enlace inventado, uno caducado y uno ya usado: los
    // tres significan lo mismo para quien lo abre, y distinguirlos sólo diría a
    // un curioso si acertó el formato.
    if (!request) {
      throw new BadRequestException('El enlace no es válido o ya se utilizó.');
    }
    return request;
  }
}
