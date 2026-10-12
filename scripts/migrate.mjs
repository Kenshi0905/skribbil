import { openDatabase } from '../server/db.mjs';
const db = await openDatabase();
console.log(`Skribbil schema ready (${db.mode}).`);
await db.close();
