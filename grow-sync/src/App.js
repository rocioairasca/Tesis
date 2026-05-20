import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { Auth0Provider } from "@auth0/auth0-react";
import { Spin } from "antd";
import { PERMISSIONS } from "./constants/permissions";

import AppLayout from './layout/Layout.js';
import MobileBottomNavigationWrapper from './components/MobileBottomNavigationWrapper';
import { NotificationsProvider } from './context/NotificationsContext';
import GuardedRoute from './routes/GuardedRoute.js';

import './App.css';

const Dashboard = lazy(() => import('./features/dashboard/Dashboard.js'));
const Users = lazy(() => import('./features/users/Users.js'));
const Inventory = lazy(() => import('./features/inventory/Inventory.js'));
const Lotes = lazy(() => import('./features/lots/Lotes.js'));
const DisabledLotes = lazy(() => import('./features/lots/DisabledLotes.js'));
const DisabledProducts = lazy(() => import('./features/inventory/DisabledInventory.js'));
const Usage = lazy(() => import('./features/usages/Usage.js'));
const DisabledUsages = lazy(() => import('./features/usages/DisabledUsages.js'));
const Vehicles = lazy(() => import('./features/vehicles/Vehicles.js'));
const DisabledVehicles = lazy(() => import('./features/vehicles/DisabledVehicles.js'));
const Planning = lazy(() => import('./features/planning/Planning.js'));
const DisabledPlanning = lazy(() => import('./features/planning/DisabledPlanning.js'));
const Harvest = lazy(() => import('./features/harvest/Harvest.js'));
const LoginRegister = lazy(() => import("./auth/LoginRegister.js"));

const PageLoader = () => (
  <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
    <Spin />
  </div>
);

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
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<LoginRegister />} />

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

              <Route path="*" element={<Navigate to="/login" />} />
            </Routes>
          </Suspense>

          <MobileBottomNavigationWrapper />
        </Router>
      </NotificationsProvider>
    </Auth0Provider>
  );
}

export default App;
