// Create a customer and print their API key (shown once). Usage: npm run customer:create -- "Team Name" email@x.com
import postgres from "postgres";
import { createHash, randomBytes } from "node:crypto";
import "./env";
const [name = "Test customer", email = null] = process.argv.slice(2);
const key = "opk_" + randomBytes(24).toString("base64url");
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const [c] = await sql`insert into customers (name, contact_email, api_key_hash)
  values (${name}, ${email}, ${createHash("sha256").update(key).digest("hex")}) returning id`;
console.log(JSON.stringify({ customer_id: c.id, name, api_key: key }, null, 2));
await sql.end();
