import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Spin } from "antd";
import { hasPermission } from "../utils/permissions";
import { getApiBaseUrl } from "../services/apiBase";

export default function GuardedRoute({
  children,
  allowedRoles,
  requiredPermission,
}) {
  const accessToken =
    typeof window !== "undefined"
      ? localStorage.getItem("access_token")
      : null;

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!accessToken);

  const apiBase = getApiBaseUrl();

  useEffect(() => {
    let cancelled = false;

    if (!accessToken) {
      setLoading(false);
      return;
    }

    setLoading(true);

    fetch(`${apiBase}/debug/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Error ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;

        const currentUser = data?.user || null;
        setUser(currentUser);

        if (currentUser) {
          localStorage.setItem("user", JSON.stringify(currentUser));
        }
      })
      .catch((err) => {
        console.warn("[Guard] fallo fetch usuario actual:", err);
        setUser(null);
        localStorage.removeItem("user");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, apiBase]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
        <Spin />
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (
    Array.isArray(allowedRoles) &&
    allowedRoles.length > 0 &&
    !allowedRoles.includes(Number(user.role))
  ) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requiredPermission && !hasPermission(user, requiredPermission)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
