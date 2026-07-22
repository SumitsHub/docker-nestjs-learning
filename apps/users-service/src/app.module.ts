import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import * as Joi from 'joi';
import { UsersModule } from './users/users.module';
import { User } from './users/user.entity';

@Module({
  imports: [
    // Joi schema — same rationale as api-gateway: catch config bugs at
    // boot, not on the first request that touches an undefined var.
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('production'),
        USERS_SERVICE_HOST: Joi.string().default('0.0.0.0'),
        USERS_SERVICE_PORT: Joi.number().port().default(4001),
        DB_HOST: Joi.string().default('127.0.0.1'),
        DB_PORT: Joi.number().port().default(5432),
        DB_USER: Joi.string().default('postgres'),
        DB_PASSWORD: Joi.string().default('postgres'),
        DB_NAME: Joi.string().default('appdb'),
      }),
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),

    // Structured JSON logs to stdout. Cluster log aggregators expect
    // one JSON object per line; pino outputs exactly that in prod.
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

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host: cfg.get<string>('DB_HOST'),
        port: cfg.get<number>('DB_PORT'),
        username: cfg.get<string>('DB_USER'),
        password: cfg.get<string>('DB_PASSWORD'),
        database: cfg.get<string>('DB_NAME'),
        entities: [User],
        // synchronize:true — convenient for learning; NEVER in prod.
        // Stage 7 replaces this with migrations.
        synchronize: true,
        retryAttempts: 5,
        retryDelay: 1000,
      }),
    }),

    UsersModule,
  ],
})
export class AppModule {}
