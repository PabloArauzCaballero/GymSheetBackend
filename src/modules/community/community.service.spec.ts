import { NotFoundException } from '@nestjs/common';
import { RoutineNotifier } from '../training/routine-notifier';
import { CommentRow, CommunityRepository } from './community.repository';
import { CommunityService } from './community.service';

const row = (over: Partial<CommentRow> = {}): CommentRow => ({
  id: 'c1',
  authorId: 'u1',
  authorName: 'Ana',
  authorPhotoUrl: 'https://media/ana.webp',
  text: 'Hola',
  replyToId: null,
  createdAt: new Date('2026-10-12T00:00:00Z'),
  likes: 2,
  likedByViewer: true,
  ...over,
});

describe('CommunityService · me gusta de comentarios', () => {
  const repository = {
    findComment: jest.fn(),
    findVisibleTarget: jest.fn(),
    setCommentLike: jest.fn(),
    listTopLevel: jest.fn(),
    listReplies: jest.fn(),
  };
  const service = new CommunityService(
    repository as unknown as CommunityRepository,
    { notify: jest.fn() } as unknown as RoutineNotifier,
  );
  const actor = { id: 'viewer' };

  beforeEach(() => jest.resetAllMocks());

  it('da el me gusta a un comentario visible de contenido visible', async () => {
    repository.findComment.mockResolvedValue({ status: 'VISIBLE', targetKind: 'ROUTINE', targetId: 'r1' });
    repository.findVisibleTarget.mockResolvedValue({ ownerId: 'u1', title: 'Rutina' });
    repository.setCommentLike.mockResolvedValue(3);
    await expect(service.setLike(actor, 'c1', true)).resolves.toEqual({ likes: 3, meGusta: true });
    expect(repository.findVisibleTarget).toHaveBeenCalledWith('ROUTINE', 'r1', 'viewer');
    expect(repository.setCommentLike).toHaveBeenCalledWith('c1', 'viewer', true);
  });

  it('quitarlo devuelve meGusta false', async () => {
    repository.findComment.mockResolvedValue({ status: 'VISIBLE', targetKind: 'EXERCISE', targetId: 'e1' });
    repository.findVisibleTarget.mockResolvedValue({ ownerId: null, title: 'Ejercicio' });
    repository.setCommentLike.mockResolvedValue(0);
    await expect(service.setLike(actor, 'c1', false)).resolves.toEqual({ likes: 0, meGusta: false });
  });

  it.each([
    ['no existe', null],
    ['está borrado por su autor', { status: 'BORRADO_AUTOR', targetKind: 'ROUTINE', targetId: 'r1' }],
    ['está oculto por moderación', { status: 'OCULTO_MODERACION', targetKind: 'ROUTINE', targetId: 'r1' }],
  ])('404 si el comentario %s', async (_label, comment) => {
    repository.findComment.mockResolvedValue(comment);
    await expect(service.setLike(actor, 'c1', true)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.setCommentLike).not.toHaveBeenCalled();
  });

  it('404 si el contenido no es visible para quien da el me gusta', async () => {
    repository.findComment.mockResolvedValue({ status: 'VISIBLE', targetKind: 'ROUTINE', targetId: 'r1' });
    repository.findVisibleTarget.mockResolvedValue(null);
    await expect(service.setLike(actor, 'c1', true)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.setCommentLike).not.toHaveBeenCalled();
  });

  it('la lista expone foto del autor, likes y meGusta también en las respuestas', async () => {
    repository.findVisibleTarget.mockResolvedValue({ ownerId: 'u1', title: 'Rutina' });
    repository.listTopLevel.mockResolvedValue([row()]);
    repository.listReplies.mockResolvedValue([
      row({ id: 'c2', replyToId: 'c1', authorPhotoUrl: null, likes: 0, likedByViewer: false }),
    ]);
    const { items } = await service.list(actor, 'ROUTINE', 'r1', { limit: 20 });
    expect(items[0]).toMatchObject({
      autor: { id: 'u1', nombre: 'Ana', fotoUrl: 'https://media/ana.webp' },
      likes: 2,
      meGusta: true,
    });
    expect(items[0].respuestas[0]).toMatchObject({ autor: { fotoUrl: null }, likes: 0, meGusta: false });
    expect(repository.listTopLevel).toHaveBeenCalledWith('ROUTINE', 'r1', 'viewer', 21, 0);
    expect(repository.listReplies).toHaveBeenCalledWith(['c1'], 'viewer');
  });
});

describe('CommunityService · valoraciones', () => {
  const distribucion = { '5': 2, '4': 1, '3': 0, '2': 0, '1': 0 };
  const repository = {
    findVisibleTarget: jest.fn(),
    summary: jest.fn(),
    findMyRating: jest.fn(),
    upsertRating: jest.fn(),
    deleteRating: jest.fn(),
  };
  const service = new CommunityService(
    repository as unknown as CommunityRepository,
    { notify: jest.fn() } as unknown as RoutineNotifier,
  );
  const actor = { id: 'viewer' };

  beforeEach(() => {
    jest.resetAllMocks();
    repository.findVisibleTarget.mockResolvedValue({ ownerId: 'u1', title: 'Rutina' });
  });

  it('el resumen trae la distribución por nota y mi valoración', async () => {
    repository.summary.mockResolvedValue({ promedio: 4.67, total: 3, distribucion });
    repository.findMyRating.mockResolvedValue(5);
    await expect(service.summary(actor, 'ROUTINE', 'r1')).resolves.toEqual({
      promedio: 4.67,
      total: 3,
      distribucion,
      miValoracion: 5,
    });
  });

  it('valorar y quitar la valoración devuelven la distribución recalculada', async () => {
    repository.upsertRating.mockResolvedValue({ promedio: 4.67, total: 3, distribucion });
    await expect(service.rate(actor, 'ROUTINE', 'r1', 4)).resolves.toEqual({
      promedio: 4.67,
      total: 3,
      distribucion,
      miValoracion: 4,
    });
    repository.deleteRating.mockResolvedValue({ promedio: 5, total: 2, distribucion: { ...distribucion, '4': 0 } });
    await expect(service.removeRating(actor, 'ROUTINE', 'r1')).resolves.toMatchObject({
      distribucion: { '5': 2, '4': 0, '3': 0, '2': 0, '1': 0 },
      miValoracion: null,
    });
  });
});
