import { Injectable } from '@nestjs/common';
import { AdminUserRow, AdminUsersRepository } from './admin-users.repository';
import { AdminUserSearchInput } from './admin-users.schemas';

/**
 * One account of the console. The shape is the one of the retired
 * `admin/membership/users` so the web only swaps the path. The four fields
 * that only the gym's front desk had (the customer profile's phone and the
 * gym-operated membership) stay as neutral values and are deprecated
 * (ADR-0026): `telefono`, `plan`, `venceEl` null and `vigente` false.
 * Subscriptions belong to each business, not to REPP's account list.
 */
export type AdminUserDto = {
  id: string;
  nombreCompleto: string;
  email: string;
  rol: string;
  estado: string;
  tenantId: string | null;
  ultimaSesion: string | null;
  telefono: null;
  plan: null;
  venceEl: null;
  vigente: false;
};

function mapUser({ total: _total, ...row }: AdminUserRow): AdminUserDto {
  return { ...row, telefono: null, plan: null, venceEl: null, vigente: false };
}

/**
 * REPP's account search (ADR-0019: `SYSTEM_ADMIN` only): the account console,
 * the permissions panel and the moderator picker (which asks `roles=CLIENTE`:
 * only a person becomes a moderator, and the promotion itself re-checks it).
 * Business accounts (`NEGOCIO`) are accounts REPP operates too, so they are
 * listed unless the roles filter leaves them out. While impersonating a gym,
 * only that gym's accounts.
 */
@Injectable()
export class AdminUsersService {
  constructor(private readonly repository: AdminUsersRepository) {}

  async search(input: AdminUserSearchInput, tenantScope: string | null) {
    const rows = await this.repository.search({
      q: input.q,
      roles: input.roles,
      status: input.status ?? null,
      tenantScope,
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    });
    const total = rows.length > 0 ? Number(rows[0].total) : 0;
    return { items: rows.map(mapUser), page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) };
  }
}
