import { isSupportedDatasetContentType } from './exercises-dataset.client';

describe('ExercisesDatasetClient content types', () => {
  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'text/plain; charset=utf-8',
    'application/octet-stream',
  ])('accepts a JSON-compatible response type: %s', (contentType) => {
    expect(isSupportedDatasetContentType(contentType)).toBe(true);
  });

  it.each(['text/html', 'image/png', 'application/zip']) (
    'rejects an unrelated response type: %s',
    (contentType) => {
      expect(isSupportedDatasetContentType(contentType)).toBe(false);
    },
  );
});
