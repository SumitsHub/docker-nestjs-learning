import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const host = process.env.USERS_SERVICE_HOST ?? '0.0.0.0';
  const port = Number(process.env.USERS_SERVICE_PORT ?? 4001);

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: { host, port },
    },
  );

  await app.listen();
  // eslint-disable-next-line no-console
  console.log(`[users-service] listening TCP on ${host}:${port}`);
}
bootstrap();
