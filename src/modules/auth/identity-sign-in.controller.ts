import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  HttpCode,
  HttpStatus,
  Injectable,
  NotFoundException,
  Post,
  Req,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { Public } from "../../common/decorators/public.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { env } from "../../config/env";
import {
  AppleSignInInput,
  appleSignInSchema,
  GoogleSignInInput,
  googleSignInSchema,
  IdentitySignupCompletionInput,
  identitySignupCompletionSchema,
} from "./auth.schemas";
import { clientDeviceContext } from "./client-device-context";
import { IdentitySignInService } from "./identity-sign-in.service";
import { IdentityProvider } from "./oidc-token-verifier";
import { signupRequestMeta } from "./signup-context";

const authThrottleOptions = {
  default: { limit: env.AUTH_RATE_LIMIT_MAX, ttl: env.RATE_LIMIT_TTL_SECONDS * 1000 },
};

const PROVIDER_KEY = "identityProvider";
const ForProvider = (provider: IdentityProvider) => SetMetadata(PROVIDER_KEY, provider);

/** Runs before validation, so a disabled provider is a plain 404 whatever the body. */
@Injectable()
class ProviderEnabledGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const provider = this.reflector.get<IdentityProvider>(PROVIDER_KEY, context.getHandler());
    const enabled = provider === "GOOGLE" ? env.AUTH_GOOGLE_ENABLED : env.AUTH_APPLE_ENABLED;
    if (!enabled) throw new NotFoundException("Recurso no encontrado.");
    return true;
  }
}

/**
 * Sign-in with Google / Apple. Each provider answers 404 while its flag
 * (`AUTH_GOOGLE_ENABLED` / `AUTH_APPLE_ENABLED`) is off.
 */
@Public()
@Throttle(authThrottleOptions)
@UseGuards(ProviderEnabledGuard)
@Controller("auth")
export class IdentitySignInController {
  constructor(private readonly identitySignIn: IdentitySignInService) {}

  @HttpCode(HttpStatus.OK)
  @ForProvider("GOOGLE")
  @Post("google")
  google(@Body(new ZodValidationPipe(googleSignInSchema)) input: GoogleSignInInput, @Req() request: Request) {
    return this.identitySignIn.signIn("GOOGLE", input.idToken, input.nonce, clientDeviceContext(request));
  }

  @HttpCode(HttpStatus.OK)
  @ForProvider("GOOGLE")
  @Post("google/complete")
  completeGoogle(
    @Body(new ZodValidationPipe(identitySignupCompletionSchema)) input: IdentitySignupCompletionInput,
    @Req() request: Request,
  ) {
    return this.identitySignIn.completeSignup("GOOGLE", input, signupRequestMeta(request));
  }

  @HttpCode(HttpStatus.OK)
  @ForProvider("APPLE")
  @Post("apple")
  apple(@Body(new ZodValidationPipe(appleSignInSchema)) input: AppleSignInInput, @Req() request: Request) {
    return this.identitySignIn.signIn("APPLE", input.identityToken, input.nonce, clientDeviceContext(request));
  }

  @HttpCode(HttpStatus.OK)
  @ForProvider("APPLE")
  @Post("apple/complete")
  completeApple(
    @Body(new ZodValidationPipe(identitySignupCompletionSchema)) input: IdentitySignupCompletionInput,
    @Req() request: Request,
  ) {
    return this.identitySignIn.completeSignup("APPLE", input, signupRequestMeta(request));
  }
}
