import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import AppLayout from './layout/Layout.js';
import Dashboard from './pages/Dashboard.js';
import Users from './pages/Users.js';
import Inventory from './pages/Inventory.js';
import LoginRegister from "./pages/auth/LoginRegister";
import './App.css'; 

function App() {
  return (
    <Router>
      <Routes>
        {/* Rutas públicas (sin layout) */}
        <Route path="/login" element={<LoginRegister />} />

        {/* Rutas privadas (con layout) */}
        <Route
          path="/dashboard"
          element={
            <AppLayout>
              <Dashboard />
            </AppLayout>
          }
        />
        <Route
          path="/usuarios"
          element={
            <AppLayout>
              <Users />
            </AppLayout>
          }
        />
        <Route
          path="/inventario"
          element={
            <AppLayout>
              <Inventory />
            </AppLayout>
          }
        />

        {/* Redirección por defecto */}
        <Route path="/" element={<Navigate to="/login" />} />
      </Routes>
    </Router>
  );
}

export default App;
