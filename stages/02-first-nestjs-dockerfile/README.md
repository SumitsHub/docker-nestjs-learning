# Stage 2 — Scaffold the monorepo + write a naive Dockerfile

**Time:** ~90 min — this is the longest stage until Stage 4.
**Goal:** Build the NestJS microservices monorepo from scratch (no `nest new` magic), verify it runs on your host, then write a deliberately *bad* Dockerfile for the gateway. Feel the pain — Stage 3 fixes it.

---

## Why we're not using `nest new`

Two reasons:

1. **Our folder isn't empty** (we already have `README.md`, `stages/`, `.gitignore`), so `nest new` gets awkward.
2. **`nest new` hides ~15 files behind a schematic.** You'll write a Dockerfile in ~30 minutes; you deserve to know exactly what's in the project you're containerizing. This pays off *hugely* in Stage 3 when we start pruning things from the image.

So: manual scaffold. Every file you create, you'll understand.

---

## What you're going to end up with

```
docker-nestjs-learning/
├── package.json                  ← one package.json for the whole monorepo
├── tsconfig.json                 ← root TS config with path aliases
├── tsconfig.build.json           ← excludes tests, dist, node_modules from build
├── nest-cli.json                 ← declares monorepo mode + all projects
├── .gitignore                    (already exists)
├── apps/
│   ├── api-gateway/
│   │   ├── src/
│   │   │   ├── main.ts           ← HTTP bootstrap
│   │   │   ├── app.module.ts
│   │   │   └── users/
│   │   │       ├── users.controller.ts     ← HTTP → forwards to microservice
│   │   │       ├── users.module.ts
│   │   │       └── users.tokens.ts         ← injection token (avoids circular import)
│   │   └── tsconfig.app.json
│   └── users-service/
│       ├── src/
│       │   ├── main.ts           ← createMicroservice() TCP bootstrap
│       │   ├── app.module.ts
│       │   └── users/
│       │       ├── users.controller.ts     ← @MessagePattern handlers
│       │       ├── users.service.ts        ← in-memory (Postgres in Stage 4)
│       │       └── users.module.ts
│       └── tsconfig.app.json
├── libs/
│   └── common/
│       ├── src/
│       │   ├── index.ts
│       │   ├── dto/
│       │   │   ├── create-user.dto.ts
│       │   │   └── user.dto.ts
│       │   └── patterns/
│       │       └── users.patterns.ts
│       └── tsconfig.lib.json
└── stages/02-first-nestjs-dockerfile/
    ├── README.md                 ← this file
    ├── NOTES.md
    ├── CHALLENGES.md
    └── Dockerfile.naive          ← YOU write this in Part D (don't peek at Stage 3!)
```

---

## Part A — Dependencies (Yarn 4 via Corepack)

We use **Yarn 4** (the current stable line), managed by **Corepack** (built into Node 22). This pins the exact Yarn version in `package.json` so every environment — laptop, CI, Docker build stage — uses the same tool. Yarn 1 is EOL; don't reach for `yarn` from Homebrew/apt.

From the repo root:

```bash
# 1. Enable Corepack (once per machine — safe to re-run)
corepack enable

# 2. Create a minimal package.json (Yarn needs one to attach itself to)
cat > package.json <<'EOF'
{
  "name": "docker-nestjs-learning",
  "version": "0.0.1",
  "private": true,
  "description": "Docker + NestJS microservices learning repo (Kubernetes-bound)"
}
EOF

# 3. Pin Yarn to the current stable release for THIS repo.
#    This writes "packageManager": "yarn@4.x.x" into package.json
#    and downloads that exact Yarn release into .yarn/releases/.
corepack use yarn@stable

# 4. Use the classic node_modules layout (not Yarn's PnP).
#    node_modules is what Docker, Nest CLI, and every third-party tool expect.
yarn config set nodeLinker node-modules

# 5. Turn off telemetry (optional but nice)
yarn config set enableTelemetry false
```

Verify:

```bash
yarn --version           # should print 4.x.x
cat package.json | grep packageManager
ls .yarn/releases/       # a single yarn-4.x.x.cjs file — this ships with the repo
cat .yarnrc.yml          # should contain nodeLinker: node-modules
```

Now install deps:

```bash
# Runtime deps
yarn add \
  @nestjs/common@^11 \
  @nestjs/core@^11 \
  @nestjs/microservices@^11 \
  @nestjs/platform-express@^11 \
  reflect-metadata@^0.2 \
  rxjs@^7 \
  class-transformer@^0.5 \
  class-validator@^0.14

# Dev deps
yarn add -D \
  @nestjs/cli@^11 \
  @nestjs/schematics@^11 \
  @types/node@^22 \
  ts-loader@^9 \
  ts-node@^10 \
  tsconfig-paths@^4 \
  typescript@^5
```

> **Why the Nest CLI as a dev dep, not global?** So that every command in this repo — laptop, teammate's machine, CI, Docker build stage — runs the same version. No "works on my machine because I have nest CLI globally installed" pain later.

Now open `package.json` (it now has `packageManager`, `dependencies`, `devDependencies`) and add the `scripts` block. Full file should look like:

```json
{
  "name": "docker-nestjs-learning",
  "version": "0.0.1",
  "private": true,
  "description": "Docker + NestJS microservices learning repo (Kubernetes-bound)",
  "packageManager": "yarn@4.x.x",
  "scripts": {
    "build": "yarn build:gateway && yarn build:users",
    "build:gateway": "nest build api-gateway",
    "build:users": "nest build users-service",
    "start:gateway": "nest start api-gateway --watch",
    "start:users": "nest start users-service --watch",
    "start:prod:gateway": "node dist/apps/api-gateway/main",
    "start:prod:users": "node dist/apps/users-service/main"
  },
  "dependencies": { "... leave as-is ...": "" },
  "devDependencies": { "... leave as-is ...": "" }
}
```

Leave the `packageManager` version exactly as Corepack wrote it (the `4.x.x` above is illustrative). And of course, don't literally paste those two dummy lines — leave your real `dependencies` / `devDependencies` blocks untouched.

> **Why the scripts still reference `nest` directly** (not `yarn nest` or `npx nest`)? Because npm-style scripts prepend `node_modules/.bin` to `PATH` — Yarn does the same. So `nest build api-gateway` just works. This makes the scripts package-manager-agnostic — a nice property when we containerize.

Finally, extend `.gitignore` with Yarn's recommended entries. Append to the existing file:

```gitignore
# Yarn 4 (Berry) — we commit the pinned Yarn release itself
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/sdks
!.yarn/versions
.yarn/cache
.yarn/install-state.gz
.pnp.*
```

Commit `.yarnrc.yml`, `.yarn/releases/yarn-4.x.x.cjs`, `package.json`, and `yarn.lock`. Those four files together mean anyone who clones + runs `yarn install` gets bit-identical dependencies — the same guarantee we'll rely on in the Docker build stage in Stage 3.

---

## Part B — Config files

Create three files at the repo root.

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@app/common": ["libs/common/src"],
      "@app/common/*": ["libs/common/src/*"]
    }
  }
}
```

> `paths` is what lets both apps do `import { … } from '@app/common'` instead of relative paths like `../../../libs/common/src`.

### `tsconfig.build.json`
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

### `nest-cli.json`
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "apps/api-gateway/src",
  "monorepo": true,
  "root": "apps/api-gateway",
  "compilerOptions": {
    "webpack": true,
    "tsConfigPath": "apps/api-gateway/tsconfig.app.json"
  },
  "projects": {
    "api-gateway": {
      "type": "application",
      "root": "apps/api-gateway",
      "entryFile": "main",
      "sourceRoot": "apps/api-gateway/src",
      "compilerOptions": {
        "tsConfigPath": "apps/api-gateway/tsconfig.app.json"
      }
    },
    "users-service": {
      "type": "application",
      "root": "apps/users-service",
      "entryFile": "main",
      "sourceRoot": "apps/users-service/src",
      "compilerOptions": {
        "tsConfigPath": "apps/users-service/tsconfig.app.json"
      }
    },
    "common": {
      "type": "library",
      "root": "libs/common",
      "entryFile": "index",
      "sourceRoot": "libs/common/src",
      "compilerOptions": {
        "tsConfigPath": "libs/common/tsconfig.lib.json"
      }
    }
  }
}
```

> **Note on `"webpack": true`:** This is Nest's default builder in monorepo mode, and we're keeping it. Webpack bundles each app — including any path-aliased library code (`@app/common`) — into a **single** `dist/apps/<name>/main.js` file. Two reasons this matters for us:
> - **Path aliases just work.** With plain `tsc` in a monorepo, `@app/common` resolution produces a nested output tree (`dist/apps/api-gateway/apps/api-gateway/src/main.js`) because tsc's `rootDir` becomes the common ancestor of all sources, which is the repo root. Webpack sidesteps that entirely.
> - **A single `main.js` per app is Docker-friendly.** In Stage 3 we'll `COPY dist/apps/api-gateway/main.js` into the runtime image — one file, one layer, easy to reason about.
>
> Trade-off: webpack externalizes `node_modules`, so the container still needs `node_modules` alongside `main.js`. That's fine — we'll ship only production deps (`yarn workspaces focus --production` pattern) in Stage 3.

---

## Part C — Shared library (`libs/common`)

Create these four files:

### `libs/common/tsconfig.lib.json`
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "../../dist/libs/common"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `libs/common/src/patterns/users.patterns.ts`
```ts
// Message patterns are the "URLs" of microservices — strings that identify
// which handler on the other side should receive a message.
// Keeping them in a shared lib means gateway and users-service can never drift.
export const USERS_PATTERNS = {
  CREATE: { cmd: 'users.create' },
  FIND_ALL: { cmd: 'users.findAll' },
  FIND_ONE: { cmd: 'users.findOne' },
} as const;
```

### `libs/common/src/dto/create-user.dto.ts`
```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;
}
```

### `libs/common/src/dto/user.dto.ts`
```ts
export class UserDto {
  id!: string;
  name!: string;
  email!: string;
  createdAt!: string;
}
```

### `libs/common/src/index.ts`
```ts
export * from './dto/create-user.dto';
export * from './dto/user.dto';
export * from './patterns/users.patterns';
```

---

## Part D — `users-service` (internal microservice, TCP)

### `apps/users-service/tsconfig.app.json`
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/apps/users-service"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test", "**/*spec.ts"]
}
```

### `apps/users-service/src/main.ts`
```ts
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
```

> **K8s foreshadowing already:** notice we read `HOST` and `PORT` from env vars with sensible defaults. We're not hardcoding. Kubernetes ConfigMaps and Secrets inject as env vars, so building this habit now = zero refactor later. Also, `0.0.0.0` (not `127.0.0.1`) is *mandatory* inside a container so traffic from other containers/Pods can reach us.

### `apps/users-service/src/app.module.ts`
```ts
import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module';

@Module({
  imports: [UsersModule],
})
export class AppModule {}
```

### `apps/users-service/src/users/users.module.ts`
```ts
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
```

### `apps/users-service/src/users/users.service.ts`
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateUserDto, UserDto } from '@app/common';

// In-memory store for Stage 2. We swap this for Postgres in Stage 4 —
// and that swap will be trivial precisely because the storage detail
// is hidden behind this service.
@Injectable()
export class UsersService {
  private readonly users = new Map<string, UserDto>();

  create(dto: CreateUserDto): UserDto {
    const user: UserDto = {
      id: randomUUID(),
      name: dto.name,
      email: dto.email,
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    return user;
  }

  findAll(): UserDto[] {
    return [...this.users.values()];
  }

  findOne(id: string): UserDto {
    const user = this.users.get(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }
}
```

### `apps/users-service/src/users/users.controller.ts`
```ts
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateUserDto, USERS_PATTERNS, UserDto } from '@app/common';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @MessagePattern(USERS_PATTERNS.CREATE)
  create(@Payload() dto: CreateUserDto): UserDto {
    return this.users.create(dto);
  }

  @MessagePattern(USERS_PATTERNS.FIND_ALL)
  findAll(): UserDto[] {
    return this.users.findAll();
  }

  @MessagePattern(USERS_PATTERNS.FIND_ONE)
  findOne(@Payload() id: string): UserDto {
    return this.users.findOne(id);
  }
}
```

> **Notice what's NOT here:** no `@Get()`, no `@Post()`, no HTTP routes. This service speaks only TCP-serialized messages. In K8s terms, its `Service` would be a `ClusterIP` (internal-only) — never exposed via Ingress.

---

## Part E — `api-gateway` (public HTTP)

### `apps/api-gateway/tsconfig.app.json`
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/apps/api-gateway"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test", "**/*spec.ts"]
}
```

### `apps/api-gateway/src/main.ts`
```ts
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[api-gateway] HTTP listening on 0.0.0.0:${port}`);
}
bootstrap();
```

### `apps/api-gateway/src/app.module.ts`
```ts
import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module';

@Module({
  imports: [UsersModule],
})
export class AppModule {}
```

### `apps/api-gateway/src/users/users.tokens.ts`
```ts
// Injection token lives in its own file to avoid circular imports:
// users.module.ts imports users.controller.ts, and users.controller.ts
// needs this token. Colocating the token in either of those files causes
// the token to be `undefined` at decorator-evaluation time.
export const USERS_CLIENT = 'USERS_CLIENT';
```

### `apps/api-gateway/src/users/users.module.ts`
```ts
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
```

> **K8s foreshadowing:** `USERS_SERVICE_HOST` defaults to `127.0.0.1` for laptop dev, will become the container name `users-service` in Stage 4 (Compose auto-DNS), and in Kubernetes will become the `Service` name (which is also DNS-resolvable). Same env var, three environments. That's 12-factor at work.

### `apps/api-gateway/src/users/users.controller.ts`
```ts
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { CreateUserDto, USERS_PATTERNS, UserDto } from '@app/common';
import { USERS_CLIENT } from './users.tokens';

@Controller('users')
export class UsersController {
  constructor(@Inject(USERS_CLIENT) private readonly client: ClientProxy) {}

  @Post()
  create(@Body() dto: CreateUserDto): Promise<UserDto> {
    return firstValueFrom(this.client.send<UserDto>(USERS_PATTERNS.CREATE, dto));
  }

  @Get()
  findAll(): Promise<UserDto[]> {
    return firstValueFrom(this.client.send<UserDto[]>(USERS_PATTERNS.FIND_ALL, {}));
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<UserDto> {
    return firstValueFrom(this.client.send<UserDto>(USERS_PATTERNS.FIND_ONE, id));
  }
}
```

---

## Part F — Run it on your host (no Docker yet)

Build both apps to prove nothing is broken:

```bash
yarn build:users
yarn build:gateway
ls -la dist/apps
```

You should see `dist/apps/api-gateway/` and `dist/apps/users-service/` each with a `main.js` and their sources compiled.

Now run them in two terminals.

**Terminal 1** — users-service:
```bash
yarn start:users
```
You should see something like `[users-service] listening TCP on 0.0.0.0:4001`.

**Terminal 2** — api-gateway:
```bash
yarn start:gateway
```
You should see `[api-gateway] HTTP listening on 0.0.0.0:3000`.

**Terminal 3** — exercise it:
```bash
# Create a user
curl -sS -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com"}' | jq

# List
curl -sS http://localhost:3000/users | jq

# Validation should fail (missing email)
curl -sS -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"nope"}' | jq
```

If all three work, you've built a working two-service microservice application. Kill both watchers (Ctrl-C) before Part G.

---

## Part G — The naive Dockerfile (do it wrong on purpose)

Now the point of this stage. Create `stages/02-first-nestjs-dockerfile/Dockerfile.naive` **without reading any Stage 3 material**. Your instructions:

**Rules for this "wrong" Dockerfile:**
- Single stage (one `FROM`).
- Copy *everything* into the image with a broad `COPY . .`.
- Install *all* dependencies (including devDependencies).
- Build both apps (even though we're only running the gateway).
- Run the gateway with `CMD ["npm", "run", "start:prod:gateway"]`.
- No `.dockerignore`. No non-root user. No HEALTHCHECK. No multi-stage.

Hints (you should still write it yourself):
- Base image: `node:22-alpine` — the version *tag* matters; we'll discuss pinning digests later.
- `WORKDIR /app`.
- Expose the port your gateway listens on.

Once written, build and inspect it from the **repo root** (not the stage folder — the build context is the whole monorepo):

```bash
# Build (the -f flag points at the naive Dockerfile in the stage folder)
docker build -f stages/02-first-nestjs-dockerfile/Dockerfile.naive -t nestjs-gateway:naive .

# Measure the pain — three things to note
docker image ls nestjs-gateway
docker image history nestjs-gateway:naive | head -20
docker image inspect nestjs-gateway:naive --format '{{.Size}}' | awk '{printf "%.1f MB\n", $1/1024/1024}'
```

Now run it and check it actually starts (users-service is not running, so calls will fail — that's fine, we're only testing that the container starts):

```bash
docker container run --rm -d --name gw-naive -p 3000:3000 nestjs-gateway:naive
sleep 2
docker container logs gw-naive
curl -sI http://localhost:3000/users     # should get a 500 or connection error — expected
docker container stop gw-naive
```

**Now measure the pain — record these in [NOTES.md](NOTES.md):**

1. **Image size in MB** — probably 800 MB → 1.4 GB. Compare to `docker image ls node:22-alpine` (~180 MB).
2. **Time from `docker stop` to actual stop** — likely ~10 seconds. Why? (Hint: revisit Stage 1's "PID 1 signals" experiment.)
3. **What's inside** — run `docker image history nestjs-gateway:naive` and identify the biggest layers. What's making the image huge?
4. **What would happen if you `docker exec` in and check `/app`?** Do it: `docker container run --rm -it nestjs-gateway:naive sh` and browse. Are your source `.ts` files there? `node_modules` with devDeps? Tests? Secrets we haven't set yet but might have accidentally copied later?

---

## Part H — Reflection prompts (fill in [NOTES.md](NOTES.md))

Before you rush to Stage 3, sit with these:

- Why does copying the whole monorepo into one image feel wrong now? What would a K8s cluster hate about pulling a 1+ GB image every rolling update?
- What did we ship inside the image that has *no business* being in production? (Tests? TypeScript sources? devDependencies? Git metadata? README?)
- If you deployed 3 replicas of this to Kubernetes, how much bandwidth and disk would that consume vs. a 150 MB slim image?
- We built *both* apps but only run *one* per container. Is that fine or wasteful?

Then move on to [Stage 3](../03-production-dockerfile/README.md) — where we'll build one small, secure, per-service image using multi-stage builds, and you'll see the size drop by 6–8×.
