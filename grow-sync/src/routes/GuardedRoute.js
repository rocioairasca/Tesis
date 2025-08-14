import React, { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Spin } from "antd";

export default function GuardedRoute({ children, allowedRoles }) {
  const accessToken = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const email =
    (typeof window !== "undefined" ? localStorage.getItem("auth_email") : null) ||
    (typeof window !== "undefined" ? JSON.parse(localStorage.getItem("user") || "null")?.email : null);

  const apiBase = useMemo(() => (process.env.REACT_APP_API_URL || "http://localhost:4000") + "/api", []);

  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const needRole = Array.isArray(allowedRoles) && allowedRoles.length > 0;

    // MODO SEGURO: si no hay email, NO bloqueamos la UI, sólo avisamos.
    if (!needRole || !accessToken || !email) return;

    setLoading(true);
    fetch(`${apiBase}/users/email/${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => !cancelled && setRole(data?.role ?? null))
      .catch((err) => console.warn("[Guard] fallo fetch rol:", err))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [allowedRoles, accessToken, email, apiBase]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
        <Spin />
      </div>
    );
  }

  // Regla mínima: si NO hay token -> a login
  if (!accessToken) {
    console.warn("[Guard] No hay access_token -> /login");
    return <Navigate to="/login" replace />;
  }

  // MODO SEGURO: si hay restricción por rol pero no hay email/rol aún, NO bloqueamos.
  if (allowedRoles?.length && role != null && !allowedRoles.includes(role)) {
    console.warn("[Guard] Rol no permitido. role=", role, "allowed=", allowedRoles);
    return <Navigate to="/dashboard" replace />;
  }

  // Renderizamos el contenido
  return children;
}
