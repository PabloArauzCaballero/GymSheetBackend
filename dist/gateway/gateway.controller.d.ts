import { GatewayService } from './gateway.service';
export declare class GatewayController {
    private readonly gatewayService;
    constructor(gatewayService: GatewayService);
    health(): {
        status: string;
        service: string;
        checkedAt: string;
    };
    routes(): {
        version: string;
        modules: string[];
    };
}
