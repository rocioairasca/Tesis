const requireTenant = require('../middleware/requireTenant');

const unauthorized = () => Object.assign(new Error('Sesión de notificaciones no autorizada.'), {
  data: { code: 'SOCKET_UNAUTHORIZED' },
});

// Adapt the SAME Express verifier; issuer, audience, RS256 and JWKS stay in checkJwt.
function runMiddleware(middleware, req) {
  return new Promise((resolve, reject) => {
    const res = { status() { return this; }, json() { reject(unauthorized()); } };
    Promise.resolve(middleware(req, res, error => error ? reject(error) : resolve())).catch(reject);
  });
}

function createSocketAuthentication({ checkJwt, db, now = Date.now }) {
  async function identity(subject) {
    if (typeof subject !== 'string' || !subject) throw unauthorized();
    const columns = 'id,company_id,enabled,auth0_id,auth0_sub';
    const find = column => db.from('users').select(columns).eq(column, subject).maybeSingle();
    let result = await find('auth0_id');
    if (result.error) throw unauthorized();
    if (!result.data) result = await find('auth0_sub');
    const user = result.data;
    if (result.error || !user?.id || user.enabled !== true) throw unauthorized();
    // No email fallback or identity linking writes during a socket handshake.
    const req = { user };
    await runMiddleware(requireTenant, req);
    const company = await db.from('companies').select('id').eq('id', user.company_id).maybeSingle();
    if (company.error || !company.data) throw unauthorized();
    return { userId: user.id, companyId: user.company_id, subject };
  }

  async function authenticate(token) {
    if (typeof token !== 'string' || !token || /\s/.test(token)) throw unauthorized();
    const req = { method: 'GET', headers: { authorization: `Bearer ${token}` } };
    await runMiddleware(checkJwt, req);
    const { sub, exp } = req.auth || {};
    if (!Number.isFinite(exp) || exp * 1000 <= now()) throw unauthorized();
    return { ...await identity(sub), expiresAt: exp * 1000 };
  }

  async function revalidate(session) {
    if (!session || session.expiresAt <= now()) throw unauthorized();
    const current = await identity(session.subject);
    if (current.userId !== session.userId || current.companyId !== session.companyId ||
        session.expiresAt <= now()) throw unauthorized();
  }
  return { authenticate, revalidate };
}

module.exports = { createSocketAuthentication, unauthorized };
