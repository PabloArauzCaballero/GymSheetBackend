import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { NotificationChannel, RefreshTokenRevokedReason } from '../../common/enums/domain.enums';
import { PasswordResetService } from './password-reset.service';

/**
 * Lo que se prueba aquí es la política, no el ORM.
 *
 * Cada caso corresponde a una decisión de seguridad que, si alguien la deshace
 * por comodidad más adelante, no rompe ninguna pantalla y por eso no se nota:
 * que un correo desconocido responda igual que uno registrado, que el PIN viaje
 * hasheado, que un código gastado no sirva dos veces y que fallar cueste
 * intentos. Son justo las que un test de interfaz jamás detectaría.
 */

type TokenRow = {
  usuarioId: string;
  pinHash: string;
  expiraEn: Date;
  consumidoEn: Date | null;
  intentos: number;
  update: jest.Mock;
  increment: jest.Mock;
};

function buildService(options: {
  user: { id: string } | null;
  existingToken?: TokenRow | null;
}) {
  const created: Record<string, unknown>[] = [];
  const tokens = {
    update: jest.fn().mockResolvedValue([1]),
    create: jest.fn(async (values: Record<string, unknown>) => {
      created.push(values);
      return values;
    }),
    findOne: jest.fn().mockResolvedValue(options.existingToken ?? null),
  };
  const users = {
    findActiveByEmail: jest.fn().mockResolvedValue(options.user),
    updatePasswordHash: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { enqueueDirectMessage: jest.fn().mockResolvedValue(true) };
  const refreshTokens = { revokeAllForUser: jest.fn().mockResolvedValue([0]) };
  // La transacción se ejecuta en el acto: aquí no se prueba el aislamiento de
  // PostgreSQL, sino qué se escribe dentro de ella.
  const sequelize = {
    transaction: jest.fn(async (run: (t: unknown) => Promise<unknown>) => run({})),
  };

  const service = new PasswordResetService(
    tokens as never,
    users as never,
    notifications as never,
    refreshTokens as never,
    sequelize as never,
  );
  return { service, tokens, users, notifications, refreshTokens, created };
}

describe('PasswordResetService', () => {
  describe('requestPin', () => {
    it('does not reveal whether the account exists', async () => {
      const { service, tokens, notifications } = buildService({ user: null });

      await expect(service.requestPin('desconocido@gymsheet.local', null)).resolves.toBeUndefined();

      // Ni token ni correo: nada observable desde fuera distingue este caso del
      // de una cuenta real, que es exactamente el punto.
      expect(tokens.create).not.toHaveBeenCalled();
      expect(notifications.enqueueDirectMessage).not.toHaveBeenCalled();
    });

    it('stores the PIN hashed and emails the code through the messaging port', async () => {
      const { service, notifications, created } = buildService({ user: { id: 'user-1' } });

      await service.requestPin('athlete@gymsheet.local', '10.0.0.1');

      expect(created).toHaveLength(1);
      const stored = created[0] as { pinHash: string; expiraEn: Date };
      const [[message]] = notifications.enqueueDirectMessage.mock.calls as [
        [{ body: string; channel: NotificationChannel }],
      ];
      const pin = /\b(\d{6})\b/u.exec(message.body)?.[1];

      expect(pin).toBeDefined();
      // El código en claro no está en la fila; sólo su hash, y ese hash
      // corresponde al código que se envió.
      expect(stored.pinHash).not.toContain(pin as string);
      await expect(bcrypt.compare(pin as string, stored.pinHash)).resolves.toBe(true);
      expect(message.channel).toBe(NotificationChannel.EMAIL);
      expect(stored.expiraEn.getTime()).toBeGreaterThan(Date.now());
    });

    it('invalidates any previous pending code before issuing a new one', async () => {
      const { service, tokens } = buildService({ user: { id: 'user-1' } });

      await service.requestPin('athlete@gymsheet.local', null);

      // Sin esto, pedir el código dos veces dejaría dos válidos y la ventana de
      // ataque crecería con la impaciencia del usuario.
      expect(tokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ consumidoEn: expect.any(Date) as Date }),
        expect.objectContaining({ where: { usuarioId: 'user-1', consumidoEn: null } }),
      );
    });
  });

  describe('confirm', () => {
    const futureDate = () => new Date(Date.now() + 600_000);

    function tokenFor(pin: string, overrides: Partial<TokenRow> = {}): TokenRow {
      return {
        usuarioId: 'user-1',
        pinHash: bcrypt.hashSync(pin, 4),
        expiraEn: futureDate(),
        consumidoEn: null,
        intentos: 0,
        update: jest.fn().mockResolvedValue(undefined),
        increment: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('sets the new password and burns the code', async () => {
      const token = tokenFor('123456');
      const { service, users } = buildService({ user: { id: 'user-1' }, existingToken: token });

      await service.confirm('athlete@gymsheet.local', '123456', 'ClaveNueva2026!');

      expect(users.updatePasswordHash).toHaveBeenCalledTimes(1);
      const [, passwordHash] = users.updatePasswordHash.mock.calls[0] as [string, string];
      await expect(bcrypt.compare('ClaveNueva2026!', passwordHash)).resolves.toBe(true);
      expect(token.update).toHaveBeenCalledWith(
        expect.objectContaining({ consumidoEn: expect.any(Date) as Date }),
        expect.anything(),
      );
    });

    it('ends every open session, because that is the point of resetting', async () => {
      const token = tokenFor('123456');
      const { service, refreshTokens } = buildService({
        user: { id: 'user-1' },
        existingToken: token,
      });

      await service.confirm('athlete@gymsheet.local', '123456', 'ClaveNueva2026!');

      // Restablecer tras un robo no sirve de nada si los refresh tokens que
      // obtuvo el intruso siguen vivos.
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
        RefreshTokenRevokedReason.PASSWORD_RESET,
        expect.anything(),
      );
    });

    it('counts a wrong code as an attempt and rejects it', async () => {
      const token = tokenFor('123456');
      const { service, users } = buildService({ user: { id: 'user-1' }, existingToken: token });

      await expect(
        service.confirm('athlete@gymsheet.local', '000000', 'ClaveNueva2026!'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(token.increment).toHaveBeenCalledWith('intentos');
      expect(users.updatePasswordHash).not.toHaveBeenCalled();
    });

    it('burns a code that already ran out of attempts', async () => {
      const token = tokenFor('123456', { intentos: 99 });
      const { service } = buildService({ user: { id: 'user-1' }, existingToken: token });

      await expect(
        service.confirm('athlete@gymsheet.local', '123456', 'ClaveNueva2026!'),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Se quema aunque el código fuera el correcto: agotados los intentos, ese
      // token no debe seguir vivo esperando al siguiente.
      expect(token.update).toHaveBeenCalledWith(
        expect.objectContaining({ consumidoEn: expect.any(Date) as Date }),
      );
    });

    it('rejects with the same error when there is no pending code', async () => {
      const { service } = buildService({ user: { id: 'user-1' }, existingToken: null });

      await expect(
        service.confirm('athlete@gymsheet.local', '123456', 'ClaveNueva2026!'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
