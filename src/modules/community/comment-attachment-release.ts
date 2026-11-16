import { Injectable, Logger } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { hasOpenReportSql } from "../../common/moderation/open-report.sql";
import { ownMediaKey } from "../../common/media/own-media-key";
import { env } from "../../config/env";

/** Folder of an author's comment attachments in our storage. */
export const COMMENT_ATTACHMENT_FOLDER = "publicaciones";
import { MediaReferencesRepository } from "../media/media-references.repository";
import { MediaReleaseService } from "../media/media-release.service";
import { ContentCommentModel } from "./content-comment.model";

/** Fields an author's deletion clears; the row stays so replies keep their thread. */
const WIPED_COMMENT = {
  status: "BORRADO_AUTOR",
  text: "",
  attachmentKind: null,
  attachmentUrl: null,
  attachmentMime: null,
  attachmentName: null,
  attachmentBytes: null,
  attachmentWidth: null,
  attachmentHeight: null,
} as const;

/**
 * Storage key of an attachment uploaded to our storage by the author: the URL
 * is `<public base>/users/<author>/publicaciones/<file>`. Giphy links, foreign
 * URLs and any path that is not a plain key inside that folder yield null.
 */
export function commentAttachmentKey(
  url: string | null,
  authorId: string,
  publicBaseUrl: string = env.MEDIA_STORAGE_PUBLIC_BASE_URL,
): string | null {
  return ownMediaKey(url, authorId, COMMENT_ATTACHMENT_FOLDER, publicBaseUrl);
}

/**
 * The author's deletion of a community comment (routine and exercise
 * comments share the table). The stored attachment is released on the single
 * `media.release` queue in the SAME transaction that clears the reference,
 * unless another row still points to the file (content-addressed keys) or a
 * moderation evidence copy holds it. The media worker re-checks both under
 * the key lock before removing anything.
 */
@Injectable()
export class CommentAttachmentRelease {
  private readonly logger = new Logger(CommentAttachmentRelease.name);

  constructor(
    private readonly sequelize: Sequelize,
    private readonly references: MediaReferencesRepository,
    private readonly mediaRelease: MediaReleaseService,
  ) {}

  /**
   * Under an OPEN report the comment is evidence: it becomes BORRADO_AUTOR
   * (no listing shows it, its author included) but keeps its text and
   * attachment, and no release is requested. The reported-content retention
   * wipes it and releases the file once every report on it is closed.
   */
  async removeByAuthor(comment: ContentCommentModel): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      await comment.reload({ transaction, lock: transaction.LOCK.UPDATE });
      if (await this.hasOpenReport(comment.id, transaction)) {
        await comment.update({ status: "BORRADO_AUTOR" }, { transaction });
        this.logger.log({ event: "community_comment.held_as_evidence", commentId: comment.id });
        return;
      }
      const storageKey = commentAttachmentKey(comment.attachmentUrl, comment.authorId);
      await comment.update(WIPED_COMMENT, { transaction });
      if (storageKey && !(await this.references.isReferenced(storageKey, transaction))) {
        await this.mediaRelease.requestRelease(
          { aggregateType: "community.comment", aggregateId: comment.id, storageKey },
          transaction,
        );
      }
    });
  }

  private async hasOpenReport(commentId: string, transaction: Transaction): Promise<boolean> {
    const [row] = await this.sequelize.query<{ open: boolean }>(
      `SELECT ${hasOpenReportSql("COMMENT", ":commentId")} AS open`,
      { type: QueryTypes.SELECT, replacements: { commentId }, transaction },
    );
    return row?.open === true;
  }
}
