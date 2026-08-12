import { logger } from './logger';

const RATE_LIMIT_STATUS_CODES = [429, 503, 504];

export function isRateLimitError(error: any, statusCode?: number): boolean {
  if (statusCode && RATE_LIMIT_STATUS_CODES.includes(statusCode)) {
    return true;
  }
  const message = error?.message?.toLowerCase() || '';
  return message.includes('too many requests') ||
         message.includes('rate limit') ||
         message.includes('429') ||
         message.includes('service unavailable');
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  onRetry?: (error: Error, attempt: number, isRateLimit: boolean) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    onRetry,
  } = options;

  let lastError: Error;
  let lastStatusCode: number | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      lastStatusCode = (error as any).statusCode;

      const isRateLimit = isRateLimitError(lastError, lastStatusCode);

      if (attempt < maxRetries) {
        const delay = isRateLimit
          ? Math.min(baseDelay * 2 * Math.pow(2, attempt - 1), maxDelay)
          : Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

        if (onRetry) {
          onRetry(lastError, attempt, isRateLimit);
        } else {
          logger.debug('Retry attempt', {
            attempt,
            maxRetries,
            delay,
            isRateLimit,
            error: lastError.message,
          });
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}
