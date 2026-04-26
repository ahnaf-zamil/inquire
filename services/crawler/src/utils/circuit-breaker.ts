import { CONFIG } from '../config';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreaker {
  failures: number;
  lastFailure: number;
  state: CircuitState;
}

class CircuitBreakerManager {
  private breakers = new Map<string, CircuitBreaker>();

  private getBreaker(service: string): CircuitBreaker {
    let breaker = this.breakers.get(service);
    if (!breaker) {
      breaker = { failures: 0, lastFailure: 0, state: 'CLOSED' };
      this.breakers.set(service, breaker);
    }
    return breaker;
  }

  recordSuccess(service: string): void {
    const breaker = this.getBreaker(service);
    breaker.failures = 0;
    breaker.state = 'CLOSED';
  }

  recordFailure(service: string): void {
    const breaker = this.getBreaker(service);
    breaker.failures++;
    breaker.lastFailure = Date.now();

    if (breaker.failures >= CONFIG.circuitFailureThreshold) {
      breaker.state = 'OPEN';
    }
  }

  isAvailable(service: string): boolean {
    const breaker = this.getBreaker(service);

    if (breaker.state === 'CLOSED') {
      return true;
    }

    if (breaker.state === 'OPEN') {
      if (Date.now() - breaker.lastFailure >= CONFIG.circuitResetTimeout) {
        breaker.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }

    return true;
  }

  getState(service: string): CircuitState {
    return this.getBreaker(service).state;
  }
}

export const circuitBreaker = new CircuitBreakerManager();
export type { CircuitState };