// All interfaces and types of the app, imported from one place: import { ... } from '../models';
//  - ./shared  is a GENERATED copy of the backend's shared models (scripts/sync-models.mjs runs before start/build)
//  - the rest are frontend-only types
export * from './shared';
export * from './safebox-object';
export * from './view';
