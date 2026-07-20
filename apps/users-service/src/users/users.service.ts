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
