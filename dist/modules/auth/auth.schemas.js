"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginSchema = exports.registerSchema = void 0;
const zod_1 = require("zod");
exports.registerSchema = zod_1.z.object({
    email: zod_1.z.string().email().max(180).transform((value) => value.toLowerCase()),
    password: zod_1.z.string().min(8).max(120),
    nombreCompleto: zod_1.z.string().min(3).max(180),
});
exports.loginSchema = zod_1.z.object({
    email: zod_1.z.string().email().max(180).transform((value) => value.toLowerCase()),
    password: zod_1.z.string().min(8).max(120),
});
//# sourceMappingURL=auth.schemas.js.map