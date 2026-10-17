import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { MusicPlaylistModel } from './music-playlist.model';
import { MusicController } from './music.controller';
import { MusicRepository } from './music.repository';
import { MusicService } from './music.service';
import { SpotifyOEmbedClient } from './spotify-oembed.client';

@Module({
  imports: [SequelizeModule.forFeature([MusicPlaylistModel])],
  controllers: [MusicController],
  providers: [MusicRepository, MusicService, SpotifyOEmbedClient],
})
export class MusicModule {}
