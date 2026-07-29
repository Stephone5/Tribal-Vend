// Shared API helper. Attaches the saved passcode to every /api call so the
// server's lock lets it through. The passcode is stored on the device and
// entered once (see the unlock screen in app.js).

export const getPass = () => localStorage.getItem("tv_pass") || "";
export const setPass = (p) => localStorage.setItem("tv_pass", p);

export async function apiFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const p = getPass();
  if (p) headers["X-Passcode"] = p;
  return fetch(url, { ...opts, headers });
}
