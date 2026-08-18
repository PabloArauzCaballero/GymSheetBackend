import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { MediaFileModel } from "../membership/media-file.model";

/** Campos gestionados por una carga; se persisten/actualizan de forma idempotente. */
export interface MediaFileUpsert {
  readonly code: string;
  readonly name: string;
  readonly fileType: string;
  readonly mimeType: string;
  readonly provider: string;
  readonly url: string;
  readonly altText: string;
  readonly license: string;
  readonly attribution: string;
  readonly width: number | null;
  readonly height: number | null;
}

@Injectable()
export class MediaRepository {
  constructor(
    @InjectModel(MediaFileModel)
    private readonly mediaFileModel: typeof MediaFileModel,
  ) {}

  /**
   * Archivos administrados por el gimnasio, el más reciente primero. El filtro
   * por `MANAGED` deja fuera el media importado de catálogos externos de
   * ejercicios, que no es reutilizable como pieza operativa.
   */
  listManaged(limit: number): Promise<MediaFileModel[]> {
    return this.mediaFileModel.findAll({
      where: { sourceType: "MANAGED" },
      order: [["updatedAt", "DESC"]],
      limit,
    });
  }

  /**
   * Inserta o reconcilia un archivo de media por su clave natural (`code`).
   * Idempotente: reejecutar con el mismo contenido deja el registro igual.
   */
  async upsertByCode(values: MediaFileUpsert): Promise<MediaFileModel> {
    const sequelize = this.mediaFileModel.sequelize;
    if (!sequelize)
      throw new Error("MediaFileModel is not attached to a Sequelize instance.");

    return sequelize.transaction(async (transaction) => {
      const managed = {
        name: values.name,
        fileType: values.fileType,
        mimeType: values.mimeType,
        sourceType: "MANAGED",
        sourceName: values.provider,
        sourceUrl: values.url,
        storageUrl: values.url,
        altText: values.altText,
        width: values.width,
        height: values.height,
        license: values.license,
        attribution: values.attribution,
        status: "ACTIVE",
      };
      const [file] = await this.mediaFileModel.findOrCreate({
        where: { code: values.code },
        defaults: { code: values.code, ...managed },
        transaction,
      });
      await file.update(managed, { transaction });
      return file;
    });
  }
}
