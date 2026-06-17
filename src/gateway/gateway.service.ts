import { Injectable } from '@nestjs/common';

@Injectable()
export class GatewayService {
  health() {
    return {
      status: 'ok',
      service: 'gym-sheet-backend',
      checkedAt: new Date().toISOString(),
    };
  }

  routes() {
    return {
      version: 'v1',
      modules: ['auth', 'profile', 'equipment', 'exercises', 'user-exercises', 'workouts', 'export'],
    };
  }
}
