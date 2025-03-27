import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import AppLayout from './layout/Layout';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Inventory from './pages/Inventory';

function App() {
  return (
    <Router>
      <AppLayout>
        <Routes>
          <Route exact path="/" component={Dashboard} />
          <Route path="/usuarios" component={Users} />
          <Route path="/inventario" component={Inventory} />
        </Routes>
      </AppLayout>
    </Router>
  );
}

export default App;
