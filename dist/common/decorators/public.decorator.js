"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Public = exports.IS_PUBLIC_ROUTE_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.IS_PUBLIC_ROUTE_KEY = 'isPublicRoute';
const Public = () => (0, common_1.SetMetadata)(exports.IS_PUBLIC_ROUTE_KEY, true);
exports.Public = Public;
//# sourceMappingURL=public.decorator.js.map