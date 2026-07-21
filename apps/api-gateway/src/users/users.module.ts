import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { UsersController } from './users.controller';
import { USERS_CLIENT } from './users.tokens';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: USERS_CLIENT,
        inject: [ConfigService],
        useFactory: (cfg: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: cfg.get<string>('USERS_SERVICE_HOST', '127.0.0.1'),
            port: Number(cfg.get<string>('USERS_SERVICE_PORT', '4001')),
          },
        }),
      },
    ]),
  ],
  controllers: [UsersController],
})
export class UsersModule {}
