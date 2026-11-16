import { Injectable } from "@nestjs/common";
import { ModerationEvidenceService } from "./moderation-evidence.service";
import { ModerationCaseContentRepository } from "./moderation-case-content.repository";
import {
  CaseContent,
  isErasedComment,
  mapCommentContent,
  mapExerciseContent,
  mapMediaContent,
  mapPlaylistContent,
  mapReelContent,
  mapRoutineContent,
  mapUserContent,
} from "./moderation-case-content.mapper";
import { ModerationTargetKind, ModerationTargetKindValue } from "./moderation.policy";
import { ChatMessageEvidence } from "./moderation-safeguards.repository";

/**
 * Why `content` is null: `ERASED` — the target no longer exists (retention,
 * account closure); `CHAT_EVIDENCE` — a chat message is shown by its evidence copy.
 */
export type CaseContentUnavailableReason = "ERASED" | "CHAT_EVIDENCE";

export type CaseContentSnapshot = {
  content: CaseContent | null;
  contentUnavailableReason: CaseContentUnavailableReason | null;
  /** Copy of a reported chat message, kept even if its sender deleted it. */
  evidence: ChatMessageEvidence | null;
};

const ERASED: CaseContentSnapshot = { content: null, contentUnavailableReason: "ERASED", evidence: null };

/**
 * What the moderator reads before deciding (ADR-0018 §9). The case file is the
 * only door: the moderator does not get the author's routes (`GET /routines/:id`
 * stays author or SYSTEM_ADMIN, ADR-0019 §4), so the snapshot is served here,
 * after the §8 refusal, hidden content included.
 */
@Injectable()
export class ModerationCaseContentService {
  constructor(
    private readonly repository: ModerationCaseContentRepository,
    private readonly evidence: ModerationEvidenceService,
  ) {}

  async snapshot(kind: ModerationTargetKindValue, targetId: string): Promise<CaseContentSnapshot> {
    if (kind === ModerationTargetKind.CHAT_MESSAGE) {
      const evidence = await this.evidence.findChatMessage(targetId);
      return evidence ? { content: null, contentUnavailableReason: "CHAT_EVIDENCE", evidence } : ERASED;
    }
    const content = await this.load(kind, targetId);
    return content ? { content, contentUnavailableReason: null, evidence: null } : ERASED;
  }

  private async load(kind: ModerationTargetKindValue, targetId: string): Promise<CaseContent | null> {
    switch (kind) {
      case ModerationTargetKind.ROUTINE: {
        const [routine, days, exercises] = await Promise.all([
          this.repository.findRoutine(targetId),
          this.repository.findRoutineDays(targetId),
          this.repository.findRoutineExercises(targetId),
        ]);
        return routine ? mapRoutineContent(routine, days, exercises) : null;
      }
      case ModerationTargetKind.EXERCISE: {
        const row = await this.repository.findExercise(targetId);
        return row ? mapExerciseContent(row) : null;
      }
      case ModerationTargetKind.COMMENT: {
        const row = await this.repository.findComment(targetId);
        return row && !isErasedComment(row) ? mapCommentContent(row) : null;
      }
      case ModerationTargetKind.REEL: {
        const row = await this.repository.findReel(targetId);
        return row ? mapReelContent(targetId, row) : null;
      }
      case ModerationTargetKind.STORY: {
        const row = await this.repository.findStory(targetId);
        return row ? mapMediaContent("STORY", row) : null;
      }
      case ModerationTargetKind.PROFILE_PHOTO: {
        const row = await this.repository.findProfilePhoto(targetId);
        return row ? mapMediaContent("PROFILE_PHOTO", row) : null;
      }
      case ModerationTargetKind.USER: {
        const row = await this.repository.findUser(targetId);
        return row && !row.closed ? mapUserContent(row) : null;
      }
      case ModerationTargetKind.MUSIC_PLAYLIST: {
        const row = await this.repository.findPlaylist(targetId);
        return row ? mapPlaylistContent(row) : null;
      }
      default:
        return null;
    }
  }
}
