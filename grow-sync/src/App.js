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

// Páginas de autenticación
import LoginRegister from "./pages/auth/LoginRegister";

// Rutas protegidas
import ProtectedRoute from "./routes/ProtectedRoute";
import RoleProtectedRoute from "./routes/RoleProtectedRoute";

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
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <AppLayout><Dashboard /></AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/usuarios" element={
            <RoleProtectedRoute allowedRoles={[3]}> {/* Solo Admin */}
              <AppLayout><Users /></AppLayout>
            </RoleProtectedRoute>
          } />

          <Route path="/inventario" element={
            <ProtectedRoute>
              <AppLayout><Inventory /></AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/lotes" element={
            <ProtectedRoute>
              <AppLayout><Lotes /></AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/lotes-deshabilitados" element={
            <ProtectedRoute>
              <AppLayout><DisabledLotes /></AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/productos-deshabilitados" element={
            <ProtectedRoute>
              <AppLayout><DisabledProducts /></AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/usage" element={
            <ProtectedRoute>
              <AppLayout><Usage /></AppLayout>
            </ProtectedRoute>
          } />

          <Route path="/usages-disabled" element={
            <ProtectedRoute>
              <AppLayout><DisabledUsages /></AppLayout>
            </ProtectedRoute>
          } />

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

