/**
 * Ruteo principal de la app.
 * 
 * Reglas:
 * - /login es público y NO usa AppLayout.
 * - El resto usa GuardedRoute (requiere usuario autenticado).
 * - allowedRoles restringe por rol (ej: [3] = Admin).
 * - MobileBottomNavigationWrapper se renderiza globalmente (solo en móvil).
 * 
 * Features principales:
 * - dashboard, users, inventory, lots, usages, vehicles, planning
 */

import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { Auth0Provider } from "@auth0/auth0-react";
import { PERMISSIONS } from "./constants/permissions";

// Layout y diseño
import AppLayout from './layout/Layout.js';

// Hooks y componentes globales
import MobileBottomNavigationWrapper from './components/MobileBottomNavigationWrapper';
import { NotificationsProvider } from './context/NotificationsContext';

// Páginas principales
import Dashboard from './features/dashboard/Dashboard.js';
import Users from './features/users/Users.js';
import Inventory from './features/inventory/Inventory.js';
import Lotes from './features/lots/Lotes.js';
import DisabledLotes from './features/lots/DisabledLotes.js';
import DisabledProducts from './features/inventory/DisabledInventory.js';
import Usage from './features/usages/Usage.js';
import DisabledUsages from './features/usages/DisabledUsages.js';
import Vehicles from './features/vehicles/Vehicles.js';
import DisabledVehicles from './features/vehicles/DisabledVehicles.js';
import Planning from './features/planning/Planning.js';
import DisabledPlanning from './features/planning/DisabledPlanning.js';
import Harvest from './features/harvest/Harvest.js';

// Páginas de autenticación
import LoginRegister from "./auth/LoginRegister.js";

// Rutas protegidas
import GuardedRoute from './routes/GuardedRoute.js';

// Estilos globales
import './App.css';

function App() {
  return (
    <Auth0Provider
      domain={process.env.REACT_APP_AUTH0_DOMAIN}
      clientId={process.env.REACT_APP_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: process.env.REACT_APP_AUTH0_API_AUDIENCE,
        scope: "openid profile email",
      }}
      useRefreshTokens={true}
      cacheLocation="localstorage"
    >
      <NotificationsProvider>
        <Router>
          <Routes>

            {/* Página de login sin layout */}
            <Route path="/login" element={<LoginRegister />} />

            {/* Dashboard */}
            <Route
              path="/dashboard"
              element={
                <GuardedRoute>
                  <AppLayout><Dashboard /></AppLayout>
                </GuardedRoute>
              }
            />

            <Route
              path="/usuarios"
              element={
                <GuardedRoute requiredPermission={PERMISSIONS.USERS_VIEW}>
                  <AppLayout><Users /></AppLayout>
                </GuardedRoute>
              }
            />

            <Route
              path="/harvest"
              element={
                <GuardedRoute requiredPermission={PERMISSIONS.HARVEST_VIEW}>
                  <AppLayout><Harvest /></AppLayout>
                </GuardedRoute>
              }
            />

            <Route
              path="/inventario"
              element={
                <GuardedRoute requiredPermission={PERMISSIONS.INVENTORY_VIEW}>
                  <AppLayout><Inventory /></AppLayout>
                </GuardedRoute>
              }
            />

            <Route
              path="/lotes"
              element={
                <GuardedRoute requiredPermission={PERMISSIONS.LOTS_VIEW}>
                  <AppLayout><Lotes /></AppLayout>
                </GuardedRoute>
              }
            />

            <Route
              path="/lotes-deshabilitados"
              element={
                <GuardedRoute requiredPermission={PERMISSIONS.LOTS_VIEW_DISABLED}>
                  <AppLayout><DisabledLotes /></AppLayout>
                </GuardedRoute>
              }
            />

            <Route
              path="/productos-deshabilitados"
              element={
                <GuardedRoute requiredPermission={PERMISSIONS.INVENTORY_VIEW_DISABLED}>
                  <AppLayout><DisabledProducts /></AppLayout>
                </GuardedRoute>
              }
            />

            <Route
              path="/usage"
              element={
                <GuardedRoute requiredPermission={PERMISSIONS.USAGE_VIEW}>
                  <AppLayout><Usage /></AppLayout>
                </GuardedRoute>
              }
            />

            <Route
              path="/usages-disabled"
              element={
                <GuardedRoute requiredPermission={PERMISSIONS.USAGE_VIEW_DISABLED}>
                  <AppLayout><DisabledUsages /></AppLayout>
                </GuardedRoute>
              }
            />

            <Route
              path="/vehiculos"
              element={
                <GuardedRoute requiredPermission={PERMISSIONS.VEHICLES_VIEW}>
                  <AppLayout><Vehicles /></AppLayout>
                </GuardedRoute>
              }
            />

            <Route
              path="/vehiculos-deshabilitados"
              element={
                <GuardedRoute requiredPermission={PERMISSIONS.VEHICLES_VIEW_DISABLED}>
                  <AppLayout><DisabledVehicles /></AppLayout>
                </GuardedRoute>
              }
            />

            <Route
              path="/planificaciones"
              element={
                <GuardedRoute requiredPermission={PERMISSIONS.PLANNING_VIEW}>
                  <AppLayout><Planning /></AppLayout>
                </GuardedRoute>
              }
            />

            <Route
              path="/planificaciones-deshabilitadas"
              element={
                <GuardedRoute requiredPermission={PERMISSIONS.PLANNING_VIEW_DISABLED}>
                  <AppLayout><DisabledPlanning /></AppLayout>
                </GuardedRoute>
              }
            />

            {/* Redirección por defecto a login */}
            <Route path="*" element={<Navigate to="/login" />} />

          </Routes>

          {/* ✅ Navegación inferior solo en móviles */}
          <MobileBottomNavigationWrapper />
        </Router>
      </NotificationsProvider>
    </Auth0Provider>
  );
}

export default App;
