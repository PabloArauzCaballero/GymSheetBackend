import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

const uuidSchema = z.string().uuid();

/** Validates route identifiers before they reach services or PostgreSQL. */
@Injectable()
export class UuidParamPipe implements PipeTransform<string, string> {
  transform(rawIdentifier: string): string {
    const parsedIdentifier = uuidSchema.safeParse(rawIdentifier);

    if (!parsedIdentifier.success) {
      throw new BadRequestException({
        message: 'El identificador debe ser un UUID válido.',
        issues: parsedIdentifier.error.flatten(),
      });
    }

    return parsedIdentifier.data;
  }
}
