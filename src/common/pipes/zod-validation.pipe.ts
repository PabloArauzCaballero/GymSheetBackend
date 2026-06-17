import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const parsedValue = this.schema.safeParse(value);

    if (!parsedValue.success) {
      throw new BadRequestException({
        message: 'Datos de entrada inválidos.',
        issues: parsedValue.error.flatten(),
      });
    }

    return parsedValue.data;
  }
}
