// src/services/authService.js
const API_BASE = (process.env.REACT_APP_API_URL || "http://localhost:4000") + "/api";

// Helper para headers con Bearer
function authHeaders() {
  const token = localStorage.getItem("access_token");
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

/**
 * LOGIN (POST /api/login)
 * body: { email, password }
 * resp esperada: { access_token, id_token? }
 */
export async function loginUser({ email, password }) {
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const err = await safeJson(res);
    throw new Error(err?.message || "No se pudo iniciar sesión");
  }

  const data = await res.json();

  // Guardamos de una el access_token y el email (para GuardedRoute)
  if (data?.access_token) localStorage.setItem("access_token", data.access_token);
  if (email) localStorage.setItem("auth_email", email);
  if (data?.id_token) localStorage.setItem("id_token", data.id_token);

  return data; // { access_token, id_token? }
}

/**
 * REGISTER (POST /api/register)
 * body: { username, email, password }
 */
export async function registerUser({ username, email, password, token }) {
  const res = await fetch(`${API_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password, token }),
  });

  const data = await safeJson(res);
  if (!res.ok) {
    // Backend suele devolver mensaje
    throw new Error(data?.message || "Error al registrar usuario");
  }
  return data; // p.ej. { message: "Usuario creado correctamente" }
}

/**
 * GET USER BY EMAIL (GET /api/users/email/:email)
 * Requiere Authorization: Bearer access_token
 */
export async function getUserDataByEmail(email) {
  if (!email) throw new Error("Email requerido");

  const res = await fetch(`${API_BASE}/users/email/${encodeURIComponent(email)}`, {
    method: "GET",
    headers: authHeaders(),
  });

  if (!res.ok) {
    const err = await safeJson(res);
    throw new Error(err?.message || "No se pudo obtener el usuario");
  }
  return res.json(); // debería incluir { role, ... }
}

/**
 * INVITE USER (POST /api/users/invite)
 * body: { email, role }
 * Requiere Authorization: Bearer access_token (Admin/Owner)
 */
export async function inviteUser({ email, role }) {
  const res = await fetch(`${API_BASE}/users/invite`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, role }),
  });

  const data = await safeJson(res);
  if (!res.ok) {
    throw new Error(data?.message || "Error al crear la invitación");
  }
  return data; // { message, inviteLink, token, invitation }
}

/**
 * GET INVITATION (GET /api/invitations/:token)
 * Obtiene información de la invitación (email)
 */
export async function getInvitation(token) {
  const res = await fetch(`${API_BASE}/invitations/${token}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  const data = await safeJson(res);
  if (!res.ok) {
    throw new Error(data?.message || "Invitación no encontrada");
  }
  return data; // { email }
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}
