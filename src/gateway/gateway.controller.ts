import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { GatewayService } from './gateway.service';

@Controller('gateway')
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  @Public()
  @Get('health')
  health() {
    return this.gatewayService.health();
  }

  @Public()
  @Get('routes')
  routes() {
    return this.gatewayService.routes();
  }
}
