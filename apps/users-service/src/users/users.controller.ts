import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateUserDto, USERS_PATTERNS, UserDto } from '@app/common';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @MessagePattern(USERS_PATTERNS.CREATE)
  create(@Payload() dto: CreateUserDto): Promise<UserDto> {
    return this.users.create(dto);
  }

  @MessagePattern(USERS_PATTERNS.FIND_ALL)
  findAll(): Promise<UserDto[]> {
    return this.users.findAll();
  }

  @MessagePattern(USERS_PATTERNS.FIND_ONE)
  findOne(@Payload() id: string): Promise<UserDto> {
    return this.users.findOne(id);
  }
}
