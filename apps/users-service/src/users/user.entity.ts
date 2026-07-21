import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// TypeORM entity: the shape of the row in the `users` table.
// `synchronize: true` (set in AppModule) auto-creates this table on
// startup from the metadata below. Convenient for learning; NEVER use
// synchronize in production — use migrations (Stage 7).
@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 320, unique: true })
  email!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
