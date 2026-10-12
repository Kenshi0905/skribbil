import { openDatabase } from '../server/db.mjs';
const username = process.argv[2];
if (!username) { console.error('Usage: npm run admin -- <registered-username>'); process.exit(1); }
const db = await openDatabase();
const result = await db.query(`INSERT INTO skribbil.platform_roles (user_id,role)
 SELECT id,'administrator' FROM skribbil.users WHERE lower(username)=lower($1)
 ON CONFLICT DO NOTHING RETURNING user_id`, [username]);
console.log(result.rows.length ? `Granted administrator role to ${username}.` : 'User does not exist, or already has the role.');
await db.close();
