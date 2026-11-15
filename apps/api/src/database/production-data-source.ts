import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database.config.js';

// Explicit deployment step only (docs/deployment.md); the API never migrates itself.
export default new DataSource(databaseOptions('production'));
