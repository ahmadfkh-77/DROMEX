/**
 * Takes the invitation token from the URL fragment exactly once (DEC-442).
 *
 * The fragment never reaches a server, a proxy, or a `Referer` header. This
 * removes it from the address bar and the session history entry before any
 * request is made, so the token is not left behind for a later screenshot,
 * bookmark, or shared link. The token is returned to be kept in memory only:
 * it is never written to localStorage, sessionStorage, a cookie, or a URL.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function takeInvitationToken(location: Location, history: History): string | null {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (location.hash !== '') {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  }
  return TOKEN.test(raw) ? raw : null;
}
