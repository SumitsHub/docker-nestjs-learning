import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  // bufferLogs: hold early bootstrap logs until pino is wired below,
  // so even the startup banner is structured JSON in production.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // enableShutdownHooks makes Nest listen for SIGTERM/SIGINT and run
  // OnApplicationShutdown / OnModuleDestroy in every module. Without
  // this, our RedisModule.onApplicationShutdown never fires, redis
  // sockets leak on every K8s rolling update, and in-flight HTTP
  // requests get dropped mid-response.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}
bootstrap();
