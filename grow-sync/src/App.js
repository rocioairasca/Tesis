import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { Auth0Provider } from "@auth0/auth0-react";

// Layout y diseño
import AppLayout from './layout/Layout.js';

// Hooks y componentes globales
import MobileBottomNavigationWrapper from './components/MobileBottomNavigationWrapper';

// Páginas principales
import Dashboard from './pages/Dashboard.js';
import Users from './pages/Users.js';
import Inventory from './pages/Inventory.js';
import Lotes from './pages/Lotes.js';
import DisabledLotes from './pages/DisabledLotes.js';
import DisabledProducts from './pages/DisabledInventory.js';
import Usage from './pages/Usage.js';
import DisabledUsages from './pages/DisabledUsages.js';
import Vehicles from './pages/Vehicles.js';
import DisabledVehicles from './pages/DisabledVehicles.js';

// Páginas de autenticación
import LoginRegister from "./pages/auth/LoginRegister";

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
      <Router>
        <Routes>

          {/* Página de login sin layout */}
          <Route path="/login" element={<LoginRegister />} />

          {/* Rutas protegidas con layout */}
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
              <GuardedRoute allowedRoles={[3]}>
                <AppLayout><Users /></AppLayout>
              </GuardedRoute>
            }
          />

          <Route
            path="/inventario"
            element={
              <GuardedRoute>
                <AppLayout><Inventory /></AppLayout>
              </GuardedRoute>
            }
          />

          <Route
            path="/lotes"
            element={
              <GuardedRoute >
                <AppLayout><Lotes /></AppLayout>
              </GuardedRoute>
            }
          />

          <Route
            path="/lotes-deshabilitados"
            element={
              <GuardedRoute allowedRoles={[3]}>
                <AppLayout><DisabledLotes /></AppLayout>
              </GuardedRoute>
            }
          />

          <Route
            path="/productos-deshabilitados"
            element={
              <GuardedRoute allowedRoles={[3]}>
                <AppLayout><DisabledProducts /></AppLayout>
              </GuardedRoute>
            }
          />

          <Route
            path="/usage"
            element={
              <GuardedRoute >
                <AppLayout><Usage /></AppLayout>
              </GuardedRoute>
            }
          />

          <Route
            path="/usages-disabled"
            element={
              <GuardedRoute allowedRoles={[3]}>
                <AppLayout><DisabledUsages /></AppLayout>
              </GuardedRoute>
            }
          />

          <Route
            path="/vehiculos"
            element={
              <GuardedRoute >
                <AppLayout><Vehicles /></AppLayout>
              </GuardedRoute>
            }
          />

          <Route
            path="/vehiculos-deshabilitados"
            element={
              <GuardedRoute >
                <AppLayout><DisabledVehicles /></AppLayout>
              </GuardedRoute>
            }
          />

          {/* Redirección por defecto a login */}
          <Route path="*" element={<Navigate to="/login" />} />

        </Routes>

        {/* ✅ Navegación inferior solo en móviles */}
        <MobileBottomNavigationWrapper />
      </Router>
    </Auth0Provider>
  );
}

export default App;
