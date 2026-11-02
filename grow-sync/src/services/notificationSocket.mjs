// Client checks are lifecycle hints only. Authorization is always enforced by the server.
export function usableSocketToken(token, now = Date.now()) {
  if (typeof token !== 'string' || !token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.sub === 'string' && Number.isFinite(payload.exp) && payload.exp * 1000 > now;
  } catch { return false; }
}

export function startNotificationSocket({ io, origin, onNotification,
  getToken = () => localStorage.getItem('access_token'), events = window,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  let disposed = false, socket = null, sessionToken = null, rejectedToken = null;
  const stop = () => {
    if (!socket) return;
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  };
  const sync = () => {
    if (disposed) return;
    const token = getToken();
    if (!usableSocketToken(token)) { stop(); sessionToken = null; return; }
    if (socket && token === sessionToken) return;
    stop();
    if (token === rejectedToken) return; // No authentication retry loop with rejected credentials.
    sessionToken = token;
    const current = io(origin, {
      autoConnect: false,
      auth: done => {
        const latest = getToken();
        if (disposed || current !== socket || !usableSocketToken(latest)) {
          current.disconnect();
          done({});
          return;
        }
        done({ token: latest });
      },
    });
    socket = current;
    current.on('new_notification', notification => {
      if (!disposed && current === socket && getToken() === sessionToken && usableSocketToken(sessionToken)) onNotification(notification);
      else sync();
    });
    current.on('connect_error', error => {
      if (error?.data?.code === 'SOCKET_UNAUTHORIZED') {
        rejectedToken = sessionToken;
        stop();
      }
      // Transport failures use Socket.IO's reconnection and the fresh-token auth callback.
    });
    current.on('disconnect', reason => {
      if (reason === 'io server disconnect') {
        rejectedToken = sessionToken;
        stop();
      }
    });
    current.connect();
  };
  events.addEventListener('storage', sync);
  events.addEventListener('focus', sync);
  // Covers token removal/replacement in this tab without patching global Storage methods.
  const timer = setIntervalFn(sync, 1000);
  sync();
  return () => {
    disposed = true;
    clearIntervalFn(timer);
    events.removeEventListener('storage', sync);
    events.removeEventListener('focus', sync);
    stop();
  };
}
