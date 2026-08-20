// tsc only emits JavaScript, so the SQL schema has to be copied into dist/
// alongside it for the built server to find at runtime.
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/db', { recursive: true });
cpSync('src/db/schema.sql', 'dist/db/schema.sql');
console.log('copied src/db/schema.sql -> dist/db/schema.sql');
