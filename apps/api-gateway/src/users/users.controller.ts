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
import { USERS_CLIENT } from './users.module';

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
