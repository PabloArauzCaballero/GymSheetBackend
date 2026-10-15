import { readFile } from "node:fs/promises";
import { Logger } from "@nestjs/common";
import { QueryTypes, Sequelize } from "sequelize";
import { env } from "../config/env";

type ImportedPlace = {
  kind: "GYM" | "CITY";
  source: "OPENSTREETMAP";
  sourceId: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
  license: "ODbL-1.0";
  attribution: string;
};

type PlaceManifest = { records: number; license: string; sha256: string; sourceUrl: string };
const COLUMNS = ["kind", "source", "source_id", "name", "address", "city", "region", "latitude", "longitude", "tags", "license", "attribution"] as const;
const BATCH_SIZE = 250;
const logger = new Logger("SocialMapPlacesImport");

function parseArguments(argv: string[]): { input: string; manifest: string } {
  const inputIndex = argv.indexOf("--input");
  const manifestIndex = argv.indexOf("--manifest");
  const input = inputIndex >= 0 ? argv[inputIndex + 1] : undefined;
  const manifest = manifestIndex >= 0 ? argv[manifestIndex + 1] : undefined;
  if (!input || !manifest) throw new Error("Usage: yarn db:import:social-map --input <places.ndjson> --manifest <manifest.json>");
  return { input, manifest };
}

export function parsePlaces(ndjson: string): ImportedPlace[] {
  return ndjson.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const place = JSON.parse(line) as ImportedPlace;
    if (!(["GYM", "CITY"] as string[]).includes(place.kind) || place.source !== "OPENSTREETMAP"
      || !place.sourceId || !place.name?.trim() || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)
      || place.latitude < -85 || place.latitude > 85 || place.longitude < -180 || place.longitude > 180
      || (place.latitude === 0 && place.longitude === 0)
      || place.license !== "ODbL-1.0" || !place.attribution) {
      throw new Error(`Invalid or unprovenanced place on NDJSON line ${index + 1}.`);
    }
    return place;
  });
}

export async function importSocialMapPlaces(inputPath: string, manifestPath: string): Promise<number> {
  const [ndjson, manifestJson] = await Promise.all([readFile(inputPath, "utf8"), readFile(manifestPath, "utf8")]);
  const manifest = JSON.parse(manifestJson) as PlaceManifest;
  if (manifest.license !== "ODbL-1.0" || !/^([\da-f]{64})$/i.test(manifest.sha256)
    || !manifest.sourceUrl.startsWith("https://download.geofabrik.de/")) {
    throw new Error("The manifest does not identify a verified Geofabrik OSM snapshot.");
  }
  const places = parsePlaces(ndjson);
  if (places.length !== manifest.records) throw new Error("The NDJSON row count does not match the source manifest.");
  if (places.length === 0) throw new Error("Refusing to replace the current places catalog with an empty import.");

  const sequelize = new Sequelize({
    dialect: "postgres", host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME,
    username: env.DB_USER, password: env.DB_PASSWORD, logging: false,
    dialectOptions: env.DB_SSL ? { ssl: { require: true, rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } } : {},
    pool: { max: 2, min: 0 },
  });
  try {
    await sequelize.authenticate();
    await sequelize.transaction(async (transaction) => {
      await sequelize.query("UPDATE social.gym_places SET active = FALSE WHERE source = 'OPENSTREETMAP'", { transaction });
      for (let offset = 0; offset < places.length; offset += BATCH_SIZE) {
        const batch = places.slice(offset, offset + BATCH_SIZE);
        const replacements: Record<string, unknown> = {};
        const values = batch.map((place, rowIndex) => `(${COLUMNS.map((column, columnIndex) => {
          const key = `p${rowIndex}_${columnIndex}`;
          const property = ({ source_id: "sourceId" } as Record<string, string>)[column] ?? column;
          const value = (place as unknown as Record<string, unknown>)[property];
          replacements[key] = column === "tags" ? JSON.stringify(value) : value;
          return column === "tags" ? `CAST(:${key} AS jsonb)` : `:${key}`;
        }).join(", ")})`).join(", ");
        await sequelize.query(
          `INSERT INTO social.gym_places (${COLUMNS.join(", ")}) VALUES ${values}
           ON CONFLICT (source, source_id, kind) DO UPDATE SET
             name = EXCLUDED.name, address = EXCLUDED.address, city = EXCLUDED.city,
             region = EXCLUDED.region, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
             tags = EXCLUDED.tags, license = EXCLUDED.license, attribution = EXCLUDED.attribution,
             active = TRUE, imported_at = NOW()`,
          { replacements, transaction, type: QueryTypes.INSERT },
        );
      }
    });
    return places.length;
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  void (async () => {
    const { input, manifest } = parseArguments(process.argv.slice(2));
    const imported = await importSocialMapPlaces(input, manifest);
    logger.log(`Imported ${imported} verified OSM map places.`);
  })().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "OSM place import failed.");
    process.exitCode = 1;
  });
}
