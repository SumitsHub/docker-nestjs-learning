import {
  Global,
  Inject,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.tokens';

// Global so any feature module can inject REDIS_CLIENT without
// re-importing RedisModule everywhere.
//
// OnApplicationShutdown closes the redis connection on SIGTERM/SIGINT
// — requires app.enableShutdownHooks() in main.ts. Without a clean
// close, K8s rolling updates would leak sockets from redis's POV.
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const url = cfg.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
        return new Redis(url, {
          // Fail fast on temporary blips; the health indicator
          // reports "down" and K8s takes the pod out of the load
          // balancer instead of piling up retries in-process.
          maxRetriesPerRequest: 2,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit();
  }
}
