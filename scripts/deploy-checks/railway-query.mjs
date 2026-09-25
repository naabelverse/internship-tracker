/**
 * Runs one GraphQL request against Railway's public API and prints the JSON reply.
 *
 *   node scripts/deploy-checks/railway-query.mjs '<query>' '<variables as JSON>'
 *
 * Auth is the Railway CLI's own login (`railway login`), read from
 * ~/.railway/config.json, or RAILWAY_API_TOKEN if that is set. The token is sent
 * to Railway and nowhere else, and is never printed. watch-deploy.sh uses this
 * for the one thing the CLI cannot show: a service's deployment triggers.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENDPOINT = 'https://backboard.railway.com/graphql/v2';

/** The CLI stores the session token as `accessToken` in newer versions and `token` in older ones. */
function readToken() {
  if (process.env.RAILWAY_API_TOKEN) return process.env.RAILWAY_API_TOKEN;
  try {
    const { user } = JSON.parse(readFileSync(join(homedir(), '.railway', 'config.json'), 'utf8'));
    return user?.accessToken || user?.token || '';
  } catch {
    return '';
  }
}

const [query, variables = '{}'] = process.argv.slice(2);
if (!query) {
  console.error("usage: node railway-query.mjs '<query>' '<variables as JSON>'");
  process.exit(2);
}

const token = readToken();
if (!token) {
  console.error('railway-query: no token. Run `railway login`, or set RAILWAY_API_TOKEN.');
  process.exit(1);
}

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ query, variables: JSON.parse(variables) }),
});
const body = await res.json();
console.log(JSON.stringify(body, null, 2));
// "Not Authorized" here usually means the CLI session expired; `railway whoami` refreshes it.
if (!res.ok || body.errors) process.exit(1);
