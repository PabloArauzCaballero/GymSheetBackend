import { ConnectionStatus } from "../../common/enums/domain.enums";
import { ConnectionModel } from "./connection.model";
import { DirectoryRow, EarnedBadgeRow } from "./social.repository";

export type ConnectionResponse = {
  id: string;
  otherUserId: string;
  otherUserName: string;
  /** Quién la envió, para que el cliente sepa si puede responderla o solo cancelarla. */
  direction: "SENT" | "RECEIVED";
  status: ConnectionStatus;
  createdAt: Date;
};

export function mapConnectionToResponse(
  connection: ConnectionModel,
  viewerId: string,
  otherUserName: string,
): ConnectionResponse {
  const sent = connection.requesterId === viewerId;
  return {
    id: connection.id,
    otherUserId: sent ? connection.addresseeId : connection.requesterId,
    otherUserName,
    direction: sent ? "SENT" : "RECEIVED",
    status: connection.status,
    createdAt: connection.createdAt,
  };
}

export type DirectoryEntryResponse = {
  userId: string;
  /** Nombre de pila e inicial: el directorio no es una lista de socios con nombre completo. */
  displayName: string;
  objetivo: string | null;
  branchId: string | null;
  branchName: string | null;
  connectionStatus: DirectoryRow["connectionStatus"];
  connectionId: string | null;
  /** Solo si son conexión aceptada y la otra persona lo marcó visible. */
  socialStatus: string | null;
  photoUrl: string | null;
  gender: string | null;
  experienceLevel: string | null;
  points: number | null;
  levelCode: string | null;
};

export function mapDirectoryRowToResponse(row: DirectoryRow): DirectoryEntryResponse {
  return {
    userId: row.userId,
    displayName: shortenName(row.fullName),
    objetivo: row.objetivo,
    branchId: row.branchId,
    branchName: row.branchName,
    connectionStatus: row.connectionStatus,
    connectionId: row.connectionId,
    socialStatus: row.socialStatus,
    photoUrl: row.photoUrl,
    gender: row.gender,
    experienceLevel: row.experienceLevel,
    points: row.points,
    levelCode: row.levelCode,
  };
}

/**
 * Una insignia del perfil de otra persona.
 *
 * Solo se listan las conseguidas, así que `earned` es siempre `true`: el campo
 * está para que el cliente pueda pintar la misma tarjeta que en la propia senda
 * sin tener que inventarse el valor.
 */
export type EarnedBadgeResponse = {
  code: string;
  name: string;
  description: string;
  flavorText: string | null;
  category: string;
  rarity: string;
  icon: string;
  color: string;
  pointsReward: number;
  earned: true;
  earnedAt: string;
};

export function mapEarnedBadgeToResponse(row: EarnedBadgeRow): EarnedBadgeResponse {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    flavorText: row.flavorText,
    category: row.category,
    rarity: row.rarity,
    icon: row.icon,
    color: row.color,
    pointsReward: row.pointsReward,
    earned: true,
    earnedAt: row.awardedAt.toISOString(),
  };
}

/** El perfil social de un socio: su entrada del directorio más lo que ha ganado. */
export type MemberProfileResponse = DirectoryEntryResponse & {
  badges: EarnedBadgeResponse[];
};

export function mapMemberProfileToResponse(
  row: DirectoryRow,
  badges: readonly EarnedBadgeRow[],
): MemberProfileResponse {
  return {
    ...mapDirectoryRowToResponse(row),
    badges: badges.map(mapEarnedBadgeToResponse),
  };
}

/** Resultado de un swipe. `matched` es lo que dispara el modal de «¡Match!». */
export type SwipeResponse = {
  direction: "LIKE" | "PASS";
  targetId: string;
  matched: boolean;
  /** La conexión creada o aceptada. Nulo cuando el swipe fue un «paso». */
  connectionId: string | null;
};

/** Resultado de deshacer el último swipe. */
export type UndoSwipeResponse = {
  undone: "LIKE" | "PASS";
  targetId: string;
  connectionId: string | null;
  /** Verdadero si lo deshecho era un match ya formado. */
  unmatched: boolean;
};

/** «Ana María Pérez Soto» → «Ana P.» — mismo criterio que la clasificación de la senda. */
function shortenName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const surnameInitial = parts.length > 1 ? `${parts[1].charAt(0).toUpperCase()}.` : "";
  return [first, surnameInitial].filter(Boolean).join(" ");
}
