import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transport } from '@nestjs/microservices';
import {
  HealthCheck,
  HealthCheckService,
  MicroserviceHealthIndicator,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from './indicators/redis.indicator';

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly microservice: MicroserviceHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly config: ConfigService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // /livez — liveness. "Is my process alive?"
  //   K8s uses this to decide whether to RESTART the pod. Keep it
  //   TRIVIAL — anything that depends on external services here risks
  //   restart-loops during a downstream outage (postgres blip →
  //   liveness fails → K8s kills your pod → repeat forever).
  // ─────────────────────────────────────────────────────────────────────
  @Get('livez')
  @HealthCheck()
  livez() {
    return this.health.check([]);
  }

  // ─────────────────────────────────────────────────────────────────────
  // /readyz — readiness. "Am I ready to serve traffic RIGHT NOW?"
  //   K8s uses this to decide whether to add/remove this pod from the
  //   Service load-balancer endpoints. Check downstream deps here —
  //   if postgres is down, we shouldn't take traffic, but the pod
  //   itself is fine (don't restart it).
  // ─────────────────────────────────────────────────────────────────────
  @Get('readyz')
  @HealthCheck()
  readyz() {
    return this.health.check([
      () =>
        this.microservice.pingCheck('users-service', {
          transport: Transport.TCP,
          options: {
            host: this.config.get<string>('USERS_SERVICE_HOST', '127.0.0.1'),
            port: Number(this.config.get<string>('USERS_SERVICE_PORT', '4001')),
          },
        }),
      () => this.redis.pingCheck('redis'),
    ]);
  }
}
