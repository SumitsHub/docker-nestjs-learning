import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { UsersController } from './users.controller';
import { USERS_CLIENT } from './users.tokens';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: USERS_CLIENT,
        useFactory: () => ({
          transport: Transport.TCP,
          options: {
            host: process.env.USERS_SERVICE_HOST ?? '127.0.0.1',
            port: Number(process.env.USERS_SERVICE_PORT ?? 4001),
          },
        }),
      },
    ]),
  ],
  controllers: [UsersController],
})
export class UsersModule {}
