export declare class GatewayService {
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
