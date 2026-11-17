/**
 * Collection Schemas — single source of truth for worker and frontend.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { gameSchemas } from './schemas/game-schemas'

export const schemas: CollectionSchema[] = [usersSchema, ...gameSchemas]
