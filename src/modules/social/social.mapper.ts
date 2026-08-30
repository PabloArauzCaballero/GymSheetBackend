import { ConnectionModel } from "./connection.model";
import { DirectoryRow } from "./social.repository";

export type ConnectionResponse = {
  id: string;
  otherUserId: string;
  otherUserName: string;
  /** Quién la envió, para que el cliente sepa si puede responderla o solo cancelarla. */
  direction: "SENT" | "RECEIVED";
  status: string;
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

/** «Ana María Pérez Soto» → «Ana P.» — mismo criterio que la clasificación de la senda. */
function shortenName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const surnameInitial = parts.length > 1 ? `${parts[1].charAt(0).toUpperCase()}.` : "";
  return [first, surnameInitial].filter(Boolean).join(" ");
}
