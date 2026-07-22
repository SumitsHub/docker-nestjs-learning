import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import * as Joi from 'joi';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Joi schema catches missing / malformed env vars at BOOT, not at
    // first-use. In K8s that means a misconfigured Pod fails its
    // readinessProbe immediately instead of quietly serving 500s.
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('production'),
        PORT: Joi.number().port().default(3000),
        USERS_SERVICE_HOST: Joi.string().default('127.0.0.1'),
        USERS_SERVICE_PORT: Joi.number().port().default(4001),
        REDIS_URL: Joi.string().uri({ scheme: ['redis'] }).default('redis://127.0.0.1:6379'),
      }),
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),

    // Structured JSON logs to stdout — the format K8s cluster log
    // collectors (Fluent Bit, Loki, Datadog) expect. In dev we
    // pretty-print via pino-pretty for readability.
    LoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: {
          level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
          transport:
            process.env.NODE_ENV === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
        },
      }),
    }),

    // Rate limiting: 60 req / minute / IP. Uses in-memory storage by
    // default, which means EACH POD counts independently. To share the
    // budget across pods in a K8s deployment, swap in a Redis-backed
    // storage adapter (@nest-lab/throttler-storage-redis) — Stage 7.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),

    RedisModule,
    HealthModule,
    UsersModule,
  ],
  providers: [
    // Enforce ThrottlerGuard globally without decorating every controller.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
