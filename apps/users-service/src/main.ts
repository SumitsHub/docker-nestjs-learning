import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const host = process.env.USERS_SERVICE_HOST ?? '0.0.0.0';
  const port = Number(process.env.USERS_SERVICE_PORT ?? 4001);

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: { host, port },
      bufferLogs: true,
    },
  );

  app.useLogger(app.get(Logger));

  // Nest microservices support enableShutdownHooks too. Without it,
  // TypeORM DataSource never .destroy()s cleanly on SIGTERM — open
  // postgres connections leak, and K8s rolling updates take longer to
  // fully release DB pool slots.
  app.enableShutdownHooks();

  await app.listen();
}
bootstrap();
