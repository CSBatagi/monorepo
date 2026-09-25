import type { NextRequest } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from './authSession';
import { checkSessionAdmin } from './adminServer';
import { readJson } from './dataReader';

/**
 * Who may open balls in the Mundial draw: Steam admins plus the players listed
 * in mundial_config.json `drawOperators`. Returns the session when allowed.
 */
export async function mundialDrawOperator(req: NextRequest) {
  const session = verifySessionToken(req.cookies.get(SESSION_COOKIE_NAME)?.value || '');
  if (!session) return null;
  const config = await readJson('mundial_config.json');
  const operators: unknown = config?.drawOperators;
  if (Array.isArray(operators) && operators.includes(session.steamId)) return session;
  try {
    if (await checkSessionAdmin(req)) return session;
  } catch {
    // Backend unavailable: treat as not an admin.
  }
  return null;
}
