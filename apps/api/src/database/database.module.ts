import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions, databaseTarget } from './database.config.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...databaseOptions(databaseTarget()),
        retryAttempts: 1,
      }),
    }),
  ],
})
export class DatabaseModule {}
