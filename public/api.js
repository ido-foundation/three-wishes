export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function req(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'No connection. Try again.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? 'Something went wrong.');
  }
  return data;
}

export const api = {
  redeem: (code) => req('POST', '/api/redeem', { code }),
  me: () => req('GET', '/api/me'),
  check: (text) => req('POST', '/api/check', { text }),
  seal: (checkId) => req('POST', '/api/seal', { checkId }),
  wish: (id) => req('GET', `/api/wishes/${id}`),
  reveal: (id) => req('POST', `/api/wishes/${id}/reveal`, {}),
  push: (subscription) => req('POST', '/api/push', { subscription }),
  publicWish: (token) => req('GET', `/api/public/${token}`),
};
