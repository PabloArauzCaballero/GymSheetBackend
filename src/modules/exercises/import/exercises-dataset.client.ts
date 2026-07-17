import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import { env } from '../../../config/env';
import {
  ExternalExercise,
  externalExerciseDatasetSchema,
} from './exercises-dataset.schemas';

export type ExercisesDatasetSnapshot = {
  records: ExternalExercise[];
  sourceUrl: string;
  sourceVersion: string;
  contentSha256: string;
  fetchedAt: Date;
};

@Injectable()
export class ExercisesDatasetClient {
  /**
   * Downloads and validates one immutable snapshot of the configured dataset.
   * Redirects are rejected to prevent an allowlisted URL from becoming SSRF
   * through an uncontrolled redirect target.
   */
  async fetchSnapshot(): Promise<ExercisesDatasetSnapshot> {
    const sourceUrl = this.validateSourceUrl(env.EXERCISES_DATASET_JSON_URL);
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      env.EXERCISES_DATASET_TIMEOUT_MS,
    );

    try {
      const response = await fetch(sourceUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'GymSheetBackend/1.0 exercises-dataset-connector',
        },
        redirect: 'error',
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Exercises dataset returned HTTP ${response.status}.`,
        );
      }

      this.assertJsonResponse(response);
      const responseText = await this.readBoundedResponse(response);
      const contentSha256 = createHash('sha256').update(responseText).digest('hex');
      const records = this.parseDataset(responseText);
      const sourceVersion =
        this.normalizeVersionHeader(response.headers.get('etag')) ?? contentSha256;

      return {
        records,
        sourceUrl: sourceUrl.toString(),
        sourceVersion,
        contentSha256,
        fetchedAt: new Date(),
      };
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ServiceUnavailableException(
          'Exercises dataset request exceeded the configured timeout.',
        );
      }

      throw new ServiceUnavailableException(
        'Exercises dataset could not be downloaded or validated.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateSourceUrl(rawUrl: string): URL {
    const sourceUrl = new URL(rawUrl);

    if (sourceUrl.protocol !== 'https:') {
      throw new ServiceUnavailableException(
        'Exercises dataset source must use HTTPS.',
      );
    }

    const allowedHosts = new Set(
      env.EXERCISES_DATASET_ALLOWED_HOSTS.map((host) => host.toLowerCase()),
    );

    if (!allowedHosts.has(sourceUrl.hostname.toLowerCase())) {
      throw new ServiceUnavailableException(
        'Exercises dataset source host is not allowlisted.',
      );
    }

    if (sourceUrl.username || sourceUrl.password || sourceUrl.port) {
      throw new ServiceUnavailableException(
        'Exercises dataset source URL cannot include credentials or a custom port.',
      );
    }

    return sourceUrl;
  }

  private assertJsonResponse(response: Response): void {
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

    if (!contentType.includes('application/json') && !contentType.includes('text/plain')) {
      throw new ServiceUnavailableException(
        'Exercises dataset response has an unexpected content type.',
      );
    }

    const declaredLength = Number(response.headers.get('content-length'));

    if (
      Number.isFinite(declaredLength) &&
      declaredLength > env.EXERCISES_DATASET_MAX_RESPONSE_BYTES
    ) {
      throw new ServiceUnavailableException(
        'Exercises dataset response exceeds the configured byte limit.',
      );
    }
  }

  private async readBoundedResponse(response: Response): Promise<string> {
    if (!response.body) {
      throw new ServiceUnavailableException('Exercises dataset response has no body.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytesRead = 0;
    let responseText = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      bytesRead += value.byteLength;

      if (bytesRead > env.EXERCISES_DATASET_MAX_RESPONSE_BYTES) {
        await reader.cancel('response too large');
        throw new ServiceUnavailableException(
          'Exercises dataset response exceeds the configured byte limit.',
        );
      }

      responseText += decoder.decode(value, { stream: true });
    }

    responseText += decoder.decode();
    return responseText;
  }

  private parseDataset(responseText: string): ExternalExercise[] {
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(responseText) as unknown;
    } catch {
      throw new ServiceUnavailableException(
        'Exercises dataset response is not valid JSON.',
      );
    }

    try {
      return externalExerciseDatasetSchema.parse(parsedJson);
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        throw new ServiceUnavailableException({
          message: 'Exercises dataset does not match the expected contract.',
          issueCount: error.issues.length,
        });
      }
      throw error;
    }
  }

  private normalizeVersionHeader(value: string | null): string | null {
    if (!value) {
      return null;
    }

    return value.replace(/^W\//, '').replace(/^"|"$/g, '').slice(0, 80) || null;
  }
}
