import { BadRequestException } from '@nestjs/common';
import { UuidParamPipe } from './uuid-param.pipe';

describe('UuidParamPipe', () => {
  const pipe = new UuidParamPipe();

  it('returns a valid UUID unchanged', () => {
    const identifier = '550e8400-e29b-41d4-a716-446655440000';
    expect(pipe.transform(identifier)).toBe(identifier);
  });

  it('rejects malformed route identifiers', () => {
    expect(() => pipe.transform('not-a-uuid')).toThrow(BadRequestException);
  });
});
