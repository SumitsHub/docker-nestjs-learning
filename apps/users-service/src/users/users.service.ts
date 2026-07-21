import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto, UserDto } from '@app/common';
import { User } from './user.entity';

// Postgres-backed store (Stage 4). The storage detail is hidden behind
// this service, so the swap from the Stage 2 in-memory Map required
// zero changes in the controller or in api-gateway.
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  async create(dto: CreateUserDto): Promise<UserDto> {
    const user = this.repo.create({ name: dto.name, email: dto.email });
    const saved = await this.repo.save(user);
    return this.toDto(saved);
  }

  async findAll(): Promise<UserDto[]> {
    const users = await this.repo.find({ order: { createdAt: 'DESC' } });
    return users.map((u) => this.toDto(u));
  }

  async findOne(id: string): Promise<UserDto> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.toDto(user);
  }

  // Keep the wire contract (UserDto) decoupled from the DB shape (User).
  // Only the service knows about `User` — the controller and callers
  // continue to speak in UserDto.
  private toDto(user: User): UserDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
