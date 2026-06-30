export function getSyncSecretAuthError(request, env) {
  if (!env.SYNC_SECRET || env.SYNC_SECRET === '') {
    return { status: 500, message: 'SYNC_SECRET is not configured.' };
  }

  const url = new URL(request.url);
  const authHeader = request.headers.get('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const providedSecret = request.headers.get('X-Sync-Secret') || bearer || url.searchParams.get('secret');

  if (providedSecret !== env.SYNC_SECRET) {
    return { status: 401, message: 'Unauthorized: Invalid sync secret.' };
  }

  return null;
}

export async function getAdminPasswordAuthError(db, password) {
  const adminPassSetting = await db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").first();
  if (!adminPassSetting || !adminPassSetting.value) {
    return { status: 500, message: 'Admin password is not configured.' };
  }

  if (password !== adminPassSetting.value) {
    return { status: 401, message: 'Unauthorized: Invalid Admin Password' };
  }

  return null;
}
