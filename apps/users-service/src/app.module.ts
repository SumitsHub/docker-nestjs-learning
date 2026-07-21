import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { User } from './users/user.entity';

@Module({
  imports: [
    // ConfigModule reads .env + process.env into an injectable ConfigService.
    // isGlobal: true so every child module can inject ConfigService without
    // re-importing ConfigModule everywhere.
    ConfigModule.forRoot({ isGlobal: true }),

    // TypeORM DB connection, configured async so it can depend on
    // ConfigService (which needs the module system to be ready).
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host: cfg.get<string>('DB_HOST', '127.0.0.1'),
        port: Number(cfg.get<string>('DB_PORT', '5432')),
        username: cfg.get<string>('DB_USER', 'postgres'),
        password: cfg.get<string>('DB_PASSWORD', 'postgres'),
        database: cfg.get<string>('DB_NAME', 'appdb'),
        entities: [User],
        // synchronize:true auto-creates the schema from entity metadata.
        // Fine for a learning stage; NEVER in production. Stage 7
        // introduces the migration workflow that replaces this.
        synchronize: true,
        // Retry a few times so users-service tolerates a transient
        // DB blip in the seconds after `depends_on: service_healthy`.
        retryAttempts: 5,
        retryDelay: 1000,
      }),
    }),

    UsersModule,
  ],
})
export class AppModule {}
