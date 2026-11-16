import { ModerationCaseContentService } from './moderation-case-content.service';
import { ModerationTargetKind } from './moderation.policy';

describe('ModerationCaseContentService', () => {
  function build(overrides: Partial<Record<string, jest.Mock>> = {}) {
    const repository = {
      findRoutine: jest.fn().mockResolvedValue(null),
      findRoutineDays: jest.fn().mockResolvedValue([]),
      findRoutineExercises: jest.fn().mockResolvedValue([]),
      findExercise: jest.fn().mockResolvedValue(null),
      findComment: jest.fn().mockResolvedValue(null),
      findReel: jest.fn().mockResolvedValue(null),
      findStory: jest.fn().mockResolvedValue(null),
      findProfilePhoto: jest.fn().mockResolvedValue(null),
      findUser: jest.fn().mockResolvedValue(null),
      findPlaylist: jest.fn().mockResolvedValue(null),
      ...overrides,
    };
    const evidence = { findChatMessage: jest.fn().mockResolvedValue(null) };
    return { service: new ModerationCaseContentService(repository as never, evidence as never), repository, evidence };
  }

  const exercise = (dayId: string | null, name: string, sets: number) => ({
    dayId, dayName: null, weekday: null, exerciseName: name, sets, repsMin: 8, repsMax: 12, weightKg: '42.50', durationSeconds: null,
  });

  it('a routine comes with its days in order, their exercises, the sets and the reach counts', async () => {
    const { service } = build({
      findRoutine: jest.fn().mockResolvedValue({
        name: 'Privada', description: 'Solo mía', visibility: 'PRIVATE', copies: 4, liveCopies: 2, activations: 7,
      }),
      findRoutineDays: jest.fn().mockResolvedValue([
        { id: 'd1', name: 'Empuje', weekday: 1 },
        { id: 'd2', name: null, weekday: 3 },
        { id: 'd3', name: 'Vacío', weekday: null },
      ]),
      findRoutineExercises: jest.fn().mockResolvedValue([
        exercise('d1', 'Press banca', 4), exercise('d1', 'Fondos', 3), exercise('d2', 'Sentadilla', 5), exercise(null, 'Suelto', 2),
      ]),
    });
    const snapshot = await service.snapshot(ModerationTargetKind.ROUTINE, 'routine-1');
    expect(snapshot).toEqual({
      contentUnavailableReason: null,
      evidence: null,
      content: {
        kind: 'ROUTINE',
        name: 'Privada',
        description: 'Solo mía',
        visibility: 'PRIVATE',
        reach: { copies: 4, liveCopies: 2, activations: 7 },
        days: [
          {
            name: 'Empuje', weekday: 1,
            exercises: [
              { name: 'Press banca', sets: 4, repsMin: 8, repsMax: 12, weightKg: 42.5, durationSeconds: null },
              { name: 'Fondos', sets: 3, repsMin: 8, repsMax: 12, weightKg: 42.5, durationSeconds: null },
            ],
          },
          { name: null, weekday: 3, exercises: [{ name: 'Sentadilla', sets: 5, repsMin: 8, repsMax: 12, weightKg: 42.5, durationSeconds: null }] },
          { name: 'Vacío', weekday: null, exercises: [] },
          { name: null, weekday: null, exercises: [{ name: 'Suelto', sets: 2, repsMin: 8, repsMax: 12, weightKg: 42.5, durationSeconds: null }] },
        ],
      },
    });
  });

  it('an exercise names its muscle groups once, its Spanish steps and its media', async () => {
    const { service } = build({
      findExercise: jest.fn().mockResolvedValue({
        name: 'Remo', description: null, primaryGroup: 'back', groups: ['arms', 'back'],
        steps: { en: ['Pull'], es: ['Tira', 'Suelta'] }, media: [{ type: 'IMAGE', url: 'https://cdn.test/a.png' }],
      }),
    });
    const { content } = await service.snapshot(ModerationTargetKind.EXERCISE, 'exercise-1');
    expect(content).toEqual({
      kind: 'EXERCISE', name: 'Remo', description: null, muscleGroups: ['back', 'arms'],
      instructions: ['Tira', 'Suelta'], media: [{ type: 'IMAGE', url: 'https://cdn.test/a.png' }],
    });
  });

  it('a comment its author deleted under the report is still shown; a wiped one is erased', async () => {
    const held = build({ findComment: jest.fn().mockResolvedValue({ text: 'Fraude', state: 'BORRADO_AUTOR', attachmentUrl: null, attachmentType: null }) });
    expect((await held.service.snapshot(ModerationTargetKind.COMMENT, 'c-1')).content).toEqual({
      kind: 'COMMENT', text: 'Fraude', attachmentUrl: null, attachmentType: null, deletedByAuthor: true,
    });
    const wiped = build({ findComment: jest.fn().mockResolvedValue({ text: '', state: 'BORRADO_AUTOR', attachmentUrl: null, attachmentType: null }) });
    expect(await wiped.service.snapshot(ModerationTargetKind.COMMENT, 'c-1')).toEqual({ content: null, contentUnavailableReason: 'ERASED', evidence: null });
  });

  it('media kinds give their file, a closed account and a missing row are erased', async () => {
    const { service } = build({
      findReel: jest.fn().mockResolvedValue({ mimeType: 'video/mp4' }),
      findStory: jest.fn().mockResolvedValue({ mediaUrl: 'https://cdn.test/s.jpg', mediaType: 'IMAGE', caption: 'Hola' }),
      findUser: jest.fn().mockResolvedValue({ displayName: 'Ana', mainPhotoUrl: null, closed: true }),
    });
    expect((await service.snapshot(ModerationTargetKind.REEL, 'reel-1')).content).toEqual({
      kind: 'REEL', mediaUrl: '/me/reels/reel-1/media', mediaType: 'video/mp4', caption: null,
    });
    expect((await service.snapshot(ModerationTargetKind.STORY, 'story-1')).content).toMatchObject({ kind: 'STORY', caption: 'Hola' });
    expect((await service.snapshot(ModerationTargetKind.USER, 'user-1')).contentUnavailableReason).toBe('ERASED');
    expect((await service.snapshot(ModerationTargetKind.MUSIC_PLAYLIST, 'p-1')).content).toBeNull();
  });

  it('a chat message is shown by its evidence copy, and is erased when the copy is gone', async () => {
    const built = build();
    expect(await built.service.snapshot(ModerationTargetKind.CHAT_MESSAGE, 'm-1')).toEqual({ content: null, contentUnavailableReason: 'ERASED', evidence: null });
    const copy = { messageId: 'm-1', body: 'hola' };
    built.evidence.findChatMessage.mockResolvedValue(copy);
    expect(await built.service.snapshot(ModerationTargetKind.CHAT_MESSAGE, 'm-1')).toEqual({ content: null, contentUnavailableReason: 'CHAT_EVIDENCE', evidence: copy });
  });
});
