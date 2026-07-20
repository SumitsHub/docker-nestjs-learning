import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { UsersController } from './users.controller';

export const USERS_CLIENT = 'USERS_CLIENT';

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
