import { Inject, Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.tokens';

// Custom Terminus indicator: pings Redis and reports up/down.
//
// Terminus v11+ also has a service-based `HealthIndicatorService` API,
// but the class-based HealthIndicator (used here) still works and is
// what most existing tutorials + Nest docs show. Pick whichever your
// team standardizes on.
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super();
  }

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    try {
      const pong = await this.redis.ping();
      const healthy = pong === 'PONG';
      const result = this.getStatus(key, healthy, { response: pong });
      if (!healthy) {
        throw new HealthCheckError('Redis check failed', result);
      }
      return result;
    } catch (err) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, { error: (err as Error).message }),
      );
    }
  }
}
