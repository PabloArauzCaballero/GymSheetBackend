import { Global, Module } from "@nestjs/common";
import { RedisModule } from "../redis/redis.module";
import { SocketTicketService } from "./socket-ticket.service";

@Global()
@Module({
  imports: [RedisModule],
  providers: [SocketTicketService],
  exports: [SocketTicketService],
})
export class RealtimeModule {}
