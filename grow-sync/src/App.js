import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { Auth0Provider } from "@auth0/auth0-react";
import AppLayout from './layout/Layout.js';
import Dashboard from './pages/Dashboard.js';
import Users from './pages/Users.js';
import Inventory from './pages/Inventory.js';
import LoginRegister from "./pages/auth/LoginRegister";
import Lotes from './pages/Lotes.js';
import DisabledLotes from './pages/DisabledLotes.js';
import ProtectedRoute from "./routes/ProtectedRoute";
import RoleProtectedRoute from "./routes/RoleProtectedRoute";
import DisabledProducts from "./pages/DisabledInventory.js";
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
          {/* Rutas públicas (sin layout) */}
          <Route path="/login" element={<LoginRegister />} />

          {/* Rutas privadas (con layout y protegido por token) */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Dashboard />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/usuarios"
            element={
              <RoleProtectedRoute allowedRoles={[3]}> {/* Solo Admin */}
                <AppLayout>
                  <Users />
                </AppLayout>
              </RoleProtectedRoute>
            }
          />
          <Route
            path="/inventario"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Inventory />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/lotes"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Lotes />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route path="/lotes-deshabilitados" element={
            <ProtectedRoute>
              <AppLayout>
                <DisabledLotes />
              </AppLayout>
            </ProtectedRoute>
          } />
          <Route
            path="/productos-deshabilitados"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <DisabledProducts />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          
          {/* Redirección por defecto */}
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </Router>
    </Auth0Provider>
  );
}

export default App;

