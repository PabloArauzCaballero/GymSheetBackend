import { Injectable } from "@nestjs/common";
import { Sequelize } from "sequelize-typescript";
import { env } from "../../config/env";
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
 * is `<public base>/<key>` and the key lives in the author's folder
 * (`mediaTargetPrefix`). Giphy links and foreign URLs yield null.
 */
export function commentAttachmentKey(
  url: string | null,
  authorId: string,
  publicBaseUrl: string = env.MEDIA_STORAGE_PUBLIC_BASE_URL,
): string | null {
  if (!url) return null;
  const base = publicBaseUrl.replace(/\/+$/, "");
  const ownFolder = `${base}/users/${authorId}/`;
  return url.startsWith(ownFolder) ? url.slice(base.length + 1) : null;
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
  constructor(
    private readonly sequelize: Sequelize,
    private readonly references: MediaReferencesRepository,
    private readonly mediaRelease: MediaReleaseService,
  ) {}

  async removeByAuthor(comment: ContentCommentModel): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      await comment.reload({ transaction, lock: transaction.LOCK.UPDATE });
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
}
