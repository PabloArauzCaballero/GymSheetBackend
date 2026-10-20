import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../common/enums/domain.enums';
import { buildCategoryTree, mapDirectoryEntityDetail, mapDirectoryEntitySummary, mapReviewItem } from './directory.mapper';
import { DirectoryService } from './directory.service';

describe('Directory Module - Logic & Service Tests', () => {
  describe('buildCategoryTree', () => {
    it('structures flat categories into a hierarchical tree', () => {
      const flat = [
        {
          id: 'root-1',
          slug: 'tiendas',
          path: 'tiendas',
          name: 'Tiendas',
          description: null,
          iconKey: 'store',
          entityScope: 'STORE',
          parentId: null,
        },
        {
          id: 'sub-1',
          slug: 'nutricion',
          path: 'tiendas.nutricion',
          name: 'Nutrición',
          description: null,
          iconKey: 'flask',
          entityScope: 'STORE',
          parentId: 'root-1',
        },
        {
          id: 'leaf-1',
          slug: 'proteinas',
          path: 'tiendas.nutricion.proteinas',
          name: 'Proteínas',
          description: null,
          iconKey: 'sparkles',
          entityScope: 'STORE',
          parentId: 'sub-1',
        },
      ] as any;

      const tree = buildCategoryTree(flat);

      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe('root-1');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].id).toBe('sub-1');
      expect(tree[0].children[0].children).toHaveLength(1);
      expect(tree[0].children[0].children[0].id).toBe('leaf-1');
    });
  });

  describe('mapDirectoryEntityDetail & Summary', () => {
    it('properly transforms entity with App Store rating breakdown', () => {
      const mockEntity = {
        id: 'entity-1',
        slug: 'gold-standard-supps',
        entityType: 'STORE',
        name: 'Gold Standard Supps',
        headline: 'Tienda oficial de suplementos',
        description: 'La mejor suplementación importada',
        logoUrl: 'https://cdn.example.com/logo.png',
        coverUrl: 'https://cdn.example.com/cover.png',
        gallery: ['https://cdn.example.com/img1.png'],
        primaryCategory: { id: 'cat-1', name: 'Proteínas', slug: 'proteinas', path: 'tiendas.nutricion.proteinas' },
        secondaryCategories: [{ id: 'cat-2', name: 'Creatinas', slug: 'creatinas', path: 'tiendas.nutricion.creatinas' }],
        city: 'Santa Cruz',
        country: 'Bolivia',
        address: 'Av. San Martín 123',
        latitude: '-17.783300',
        longitude: '-63.182100',
        contactInfo: { whatsapp: '+59170000000' },
        businessHours: { monday: { open: '08:00', close: '20:00' } },
        isOnlineOnly: false,
        isVerified: true,
        ratingAverage: '4.85',
        ratingCount: 142,
        ratingBreakdown: { '1': 2, '2': 3, '3': 7, '4': 20, '5': 110 },
      } as any;

      const summary = mapDirectoryEntitySummary(mockEntity);
      expect(summary.ratingAverage).toBe(4.85);
      expect(summary.isVerified).toBe(true);

      const detail = mapDirectoryEntityDetail(mockEntity);
      expect(detail.ratingBreakdown).toEqual({ '1': 2, '2': 3, '3': 7, '4': 20, '5': 110 });
      expect(detail.secondaryCategories).toHaveLength(1);
      expect(detail.latitude).toBe(-17.7833);
    });
  });

  describe('mapReviewItem', () => {
    it('maps review with verified athlete seal, helpful count and owner reply', () => {
      const mockReview = {
        id: 'rev-1',
        entityId: 'ent-1',
        userId: 'user-1',
        rating: 5,
        title: 'Excelente variedad y asesoramiento',
        body: 'Compré la proteína Whey Isolate y me llegó en menos de dos horas.',
        isVerifiedAthlete: true,
        helpfulCount: 18,
        createdAt: new Date('2026-10-18T10:00:00Z'),
        editedAt: null,
        user: { id: 'user-1', fullName: 'Carlos Giménez', fotoPerfilUrl: 'https://cdn.example.com/carlos.jpg' },
        reply: {
          id: 'rep-1',
          replyText: '¡Muchas gracias Carlos! Un placer servirte.',
          createdAt: new Date('2026-10-18T12:00:00Z'),
          updatedAt: new Date('2026-10-18T12:00:00Z'),
          author: { id: 'admin-1', fullName: 'Dueño Gold Standard' },
        },
      } as any;

      const votedSet = new Set(['rev-1']);
      const dto = mapReviewItem(mockReview, votedSet);

      expect(dto.id).toBe('rev-1');
      expect(dto.isVerifiedAthlete).toBe(true);
      expect(dto.hasVotedHelpful).toBe(true);
      expect(dto.reply?.authorName).toBe('Dueño Gold Standard');
    });
  });

  describe('DirectoryService rules', () => {
    let service: DirectoryService;
    let mockRepo: any;
    let mockMembershipModel: any;
    let mockAccessDecisionModel: any;
    let mockSequelize: any;
    let mockNotificationService: any;
    let mockProductEvents: any;

    beforeEach(() => {
      mockRepo = {
        findEntityById: jest.fn(),
        findUserReviewForEntity: jest.fn(),
        createReview: jest.fn(),
        updateReview: jest.fn(),
        deleteReview: jest.fn(),
        findReviewById: jest.fn(),
        toggleHelpfulVote: jest.fn(),
        createOrUpdateReply: jest.fn(),
        getUserAvatars: jest.fn().mockResolvedValue(new Map()),
      };
      mockMembershipModel = { findOne: jest.fn() };
      mockAccessDecisionModel = { findOne: jest.fn() };
      mockSequelize = {
        transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb({})),
      };
      mockNotificationService = {
        enqueueDirectMessage: jest.fn(),
      };
      mockProductEvents = {
        emit: jest.fn(),
      };

      service = new DirectoryService(
        mockRepo,
        mockMembershipModel,
        mockAccessDecisionModel,
        mockSequelize,
        mockNotificationService,
        mockProductEvents,
      );
    });

    it('rejects duplicate review creation for the same entity by the same user', async () => {
      mockRepo.findEntityById.mockResolvedValue({ id: 'ent-1', tenantId: null });
      mockRepo.findUserReviewForEntity.mockResolvedValue({ id: 'existing-rev' });

      await expect(
        service.createReview('ent-1', 'user-1', {
          rating: 5,
          title: 'Genial',
          body: 'Muy buen lugar para entrenar hoy.',
        })
      ).rejects.toThrow(ConflictException);
    });

    it('prevents user from voting helpful on their own review', async () => {
      mockRepo.findReviewById.mockResolvedValue({ id: 'rev-1', userId: 'user-1' });

      await expect(service.toggleHelpfulVote('rev-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('allows official reply only to entity owner or admins', async () => {
      mockRepo.findReviewById.mockResolvedValue({ id: 'rev-1', entityId: 'ent-1' });
      mockRepo.findEntityById.mockResolvedValue({ id: 'ent-1', userId: 'owner-123' });

      // Unrelated user
      await expect(
        service.replyToReview('rev-1', 'stranger-999', UserRole.CLIENT, {
          reply_text: 'Intento de respuesta no autorizada',
        })
      ).rejects.toThrow(ForbiddenException);

      // Official owner
      mockRepo.createOrUpdateReply.mockResolvedValue({ id: 'rep-1' });
      mockRepo.findReviewById.mockResolvedValue({
        id: 'rev-1',
        entityId: 'ent-1',
        createdAt: new Date(),
        reply: null,
      });

      const res = await service.replyToReview('rev-1', 'owner-123', UserRole.CLIENT, {
        reply_text: 'Gracias por tu reseña.',
      });
      expect(res).toBeDefined();
    });
  });
});
