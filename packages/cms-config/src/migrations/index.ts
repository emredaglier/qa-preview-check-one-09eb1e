import * as migration_20261109_152213_initial from './20261109_152213_initial';

export const migrations = [
  {
    up: migration_20261109_152213_initial.up,
    down: migration_20261109_152213_initial.down,
    name: '20261109_152213_initial'
  },
];
