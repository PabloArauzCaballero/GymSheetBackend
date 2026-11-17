import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { env } from "../../config/env";
import type { MediaReferencesRepository } from "../media/media-references.repository";
import type { MediaReleaseService } from "../media/media-release.service";
import { CommentAttachmentRelease, commentAttachmentKey } from "./comment-attachment-release";
import type { ContentCommentModel } from "./content-comment.model";

const base = "https://media.example.test/media";
const author = "11111111-1111-4111-8111-111111111111";
const key = `users/${author}/publicaciones/abc.jpg`;

describe("commentAttachmentKey", () => {
  it("returns the key of a file in the author's folder of our storage", () => {
    expect(commentAttachmentKey(`${base}/${key}`, author, `${base}/`)).toBe(key);
  });

  it("ignores Giphy links, other people's folders and missing URLs", () => {
    expect(commentAttachmentKey("https://media.giphy.com/media/x/giphy.gif", author, base)).toBeNull();
    expect(commentAttachmentKey(`${base}/users/someone-else/publicaciones/abc.jpg`, author, base)).toBeNull();
    expect(commentAttachmentKey(null, author, base)).toBeNull();
  });

  it("never yields someone else's file through a traversal path", () => {
    const victim = "22222222-2222-4222-8222-222222222222";
    expect(commentAttachmentKey(`${base}/users/${author}/publicaciones/../../${victim}/publicaciones/x.jpg`, author, base)).toBeNull();
    expect(commentAttachmentKey(`${base}/users/${author}/../${victim}/publicaciones/x.jpg`, author, base)).toBeNull();
    expect(commentAttachmentKey(`${base}/users/${author}/publicaciones/%2e%2e/x.jpg`, author, base)).toBeNull();
  });
});

describe("CommentAttachmentRelease", () => {
  afterEach(() => jest.restoreAllMocks());
  const transaction = { LOCK: { UPDATE: "UPDATE" } } as unknown as Transaction;
  function setup(referenced: boolean, attachmentUrl: string | null, openReport = false) {
    const sequelize = {
      transaction: jest.fn((work: (t: Transaction) => Promise<unknown>) => work(transaction)),
      query: jest.fn().mockResolvedValue([{ open: openReport }]),
    } as unknown as Sequelize;
    const comment = {
      id: "c1",
      authorId: author,
      attachmentUrl,
      reload: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const references = { isReferenced: jest.fn().mockResolvedValue(referenced) };
    const mediaRelease = { requestRelease: jest.fn().mockResolvedValue(undefined) };
    const service = new CommentAttachmentRelease(
      sequelize,
      references as unknown as MediaReferencesRepository,
      mediaRelease as unknown as MediaReleaseService,
    );
    return { service, comment, references, mediaRelease };
  }

  it("wipes the comment and queues the file release in the same transaction", async () => {
    const { service, comment, references, mediaRelease } = setup(false, `${base}/${key}`);
    jest.replaceProperty(env, "MEDIA_STORAGE_PUBLIC_BASE_URL", base);

    await service.removeByAuthor(comment as unknown as ContentCommentModel);

    expect(comment.reload).toHaveBeenCalledWith({ transaction, lock: "UPDATE" });
    expect(comment.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "BORRADO_AUTOR", text: "", attachmentUrl: null }),
      { transaction },
    );
    expect(references.isReferenced).toHaveBeenCalledWith(key, transaction);
    expect(mediaRelease.requestRelease).toHaveBeenCalledWith(
      { aggregateType: "community.comment", aggregateId: "c1", storageKey: key },
      transaction,
    );
  });

  it("keeps a file another row still references", async () => {
    const { service, comment, mediaRelease } = setup(true, `${base}/${key}`);
    jest.replaceProperty(env, "MEDIA_STORAGE_PUBLIC_BASE_URL", base);

    await service.removeByAuthor(comment as unknown as ContentCommentModel);

    expect(comment.update).toHaveBeenCalled();
    expect(mediaRelease.requestRelease).not.toHaveBeenCalled();
  });

  it("queues nothing for a comment without a stored attachment", async () => {
    const { service, comment, references, mediaRelease } = setup(false, "https://media.giphy.com/media/x/giphy.gif");

    await service.removeByAuthor(comment as unknown as ContentCommentModel);

    expect(references.isReferenced).not.toHaveBeenCalled();
    expect(mediaRelease.requestRelease).not.toHaveBeenCalled();
  });

  it("under an open report hides the comment but keeps text and attachment, and queues no release", async () => {
    const { service, comment, references, mediaRelease } = setup(false, `${base}/${key}`, true);
    jest.replaceProperty(env, "MEDIA_STORAGE_PUBLIC_BASE_URL", base);

    await service.removeByAuthor(comment as unknown as ContentCommentModel);

    expect(comment.update).toHaveBeenCalledWith({ status: "BORRADO_AUTOR" }, { transaction });
    expect(references.isReferenced).not.toHaveBeenCalled();
    expect(mediaRelease.requestRelease).not.toHaveBeenCalled();
  });
});
