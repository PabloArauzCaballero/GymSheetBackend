import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { MusicService } from './music.service';
import {
  CreatePlaylistInput,
  PlaylistListQuery,
  UpdatePlaylistInput,
  createPlaylistSchema,
  playlistListQuerySchema,
  updatePlaylistSchema,
} from './music.schemas';

/**
 * Playlists de la comunidad: enlaces a Spotify, públicos o privados.
 * Se denuncian por `POST /me/reports` con `targetKind: 'MUSIC_PLAYLIST'`.
 */
@Controller('music/playlists')
export class MusicController {
  constructor(private readonly music: MusicService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(playlistListQuerySchema)) query: PlaylistListQuery,
  ) {
    return this.music.list(user, query);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPlaylistSchema)) input: CreatePlaylistInput,
  ) {
    return this.music.create(user, input);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updatePlaylistSchema)) input: UpdatePlaylistInput,
  ) {
    return this.music.update(user, id, input);
  }

  /** 200 `{ deleted: true }`, como `/me/photos/:id` y `/workouts/sets/:id`. */
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.music.remove(user, id);
  }
}
