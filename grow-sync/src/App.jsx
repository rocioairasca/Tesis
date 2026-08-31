import React, { Suspense, lazy } from "react";
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
} from "react-router-dom";
import { Spin } from "antd";
import { PERMISSIONS } from "./constants/permissions.jsx";

import AppLayout from "./layout/Layout.jsx";
import MobileBottomNavigationWrapper from "./components/MobileBottomNavigationWrapper.jsx";
import { NotificationsProvider } from "./context/NotificationsContext.jsx";
import GuardedRoute from "./routes/GuardedRoute.jsx";
import { useAppVersionChecker } from "./hooks/useAppVersionChecker.jsx";

import "./App.css";

import LandingPage from "./features/public/landingPage.jsx";
import RegisterCompany from "./features/public/registerCompany.jsx";
import PlanSelection from "./features/public/planSelection.jsx";
import PaymentSimulation from "./features/public/paymentSimulation.jsx";
import PaymentSuccess from "./features/public/paymentSuccess.jsx";
import LoginRegister from "./authentication/LoginRegister.jsx";

const Dashboard = lazy(() =>
  import("./features/dashboard/Dashboard.jsx")
);

const Users = lazy(() =>
  import("./features/users/Users.jsx")
);

const Inventory = lazy(() =>
  import("./features/inventory/Inventory.jsx")
);

const Lotes = lazy(() =>
  import("./features/lots/Lotes.jsx")
);

const LotDivisions = lazy(() =>
  import("./features/lots/LotDivisions.jsx")
);

const DisabledLotes = lazy(() =>
  import("./features/lots/DisabledLotes.jsx")
);

const DisabledProducts = lazy(() =>
  import("./features/inventory/DisabledInventory.jsx")
);

const Usage = lazy(() =>
  import("./features/usages/Usage.jsx")
);

const DisabledUsages = lazy(() =>
  import("./features/usages/DisabledUsages.jsx")
);

const Vehicles = lazy(() =>
  import("./features/vehicles/Vehicles.jsx")
);

const DisabledVehicles = lazy(() =>
  import("./features/vehicles/DisabledVehicles.jsx")
);

const Planning = lazy(() =>
  import("./features/planning/Planning.jsx")
);

const DisabledPlanning = lazy(() =>
  import("./features/planning/DisabledPlanning.jsx")
);

const Harvest = lazy(() =>
  import("./features/harvest/Harvest.jsx")
);

const DisabledHarvest = lazy(() =>
  import("./features/harvest/DisabledHarvest.jsx")
);

const RainRecords = lazy(() =>
  import("./features/rainRecords/RainRecords.jsx")
);

const PageLoader = () => (
  <div
    style={{
      display: "flex",
      justifyContent: "center",
      padding: 32,
    }}
  >
    <Spin />
  </div>
);

/**
 * Envuelve solamente las páginas privadas.
 *
 * De esta forma:
 * - GuardedRoute valida la sesión y los permisos.
 * - NotificationsProvider se inicializa solo con usuarios autenticados.
 * - AppLayout muestra el header, sidebar y contenido privado.
 */
const PrivatePage = ({
  children,
  requiredPermission,
}) => (
  <GuardedRoute
    requiredPermission={requiredPermission}
  >
    <NotificationsProvider>
      <AppLayout>
        {children}
      </AppLayout>
    </NotificationsProvider>
  </GuardedRoute>
);

function App() {
  useAppVersionChecker();

  return (
    <Router>
      <Suspense fallback={<PageLoader />}>
        <Routes>
            {/* ========================= */}
            {/* Rutas públicas            */}
            {/* ========================= */}

            <Route
              path="/"
              element={<LandingPage />}
            />

            <Route
              path="/login"
              element={<LoginRegister />}
            />

            <Route
              path="/select-plan"
              element={<PlanSelection />}
            />

            <Route
              path="/payment"
              element={<PaymentSimulation />}
            />

            <Route
              path="/payment/success"
              element={<PaymentSuccess />}
            />

            <Route
              path="/register-company"
              element={<RegisterCompany />}
            />

            {/* ========================= */}
            {/* Rutas privadas            */}
            {/* ========================= */}

            <Route
              path="/dashboard"
              element={
                <PrivatePage>
                  <Dashboard />
                </PrivatePage>
              }
            />

            <Route
              path="/usuarios"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.USERS_VIEW
                  }
                >
                  <Users />
                </PrivatePage>
              }
            />

            <Route
              path="/harvest"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.HARVEST_VIEW
                  }
                >
                  <Harvest />
                </PrivatePage>
              }
            />

            <Route
              path="/harvest-deshabilitadas"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.HARVEST_VIEW_DISABLED
                  }
                >
                  <DisabledHarvest />
                </PrivatePage>
              }
            />

            <Route
              path="/registro-lluvias"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.RAIN_RECORDS_VIEW
                  }
                >
                  <RainRecords />
                </PrivatePage>
              }
            />

            <Route
              path="/inventario"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.INVENTORY_VIEW
                  }
                >
                  <Inventory />
                </PrivatePage>
              }
            />

            <Route
              path="/productos-deshabilitados"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.INVENTORY_VIEW_DISABLED
                  }
                >
                  <DisabledProducts />
                </PrivatePage>
              }
            />

            <Route
              path="/lotes"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.LOTS_VIEW
                  }
                >
                  <Lotes />
                </PrivatePage>
              }
            />

            <Route
              path="/lotes-deshabilitados"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.LOTS_VIEW_DISABLED
                  }
                >
                  <DisabledLotes />
                </PrivatePage>
              }
            />

            <Route
              path="/lotes/:lotId/divisiones"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.LOTS_VIEW
                  }
                >
                  <LotDivisions />
                </PrivatePage>
              }
            />

            <Route
              path="/usage"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.USAGE_VIEW
                  }
                >
                  <Usage />
                </PrivatePage>
              }
            />

            <Route
              path="/usages-disabled"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.USAGE_VIEW_DISABLED
                  }
                >
                  <DisabledUsages />
                </PrivatePage>
              }
            />

            <Route
              path="/vehiculos"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.VEHICLES_VIEW
                  }
                >
                  <Vehicles />
                </PrivatePage>
              }
            />

            <Route
              path="/vehiculos-deshabilitados"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.VEHICLES_VIEW_DISABLED
                  }
                >
                  <DisabledVehicles />
                </PrivatePage>
              }
            />

            <Route
              path="/planificaciones"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.PLANNING_VIEW
                  }
                >
                  <Planning />
                </PrivatePage>
              }
            />

            <Route
              path="/planificaciones-deshabilitadas"
              element={
                <PrivatePage
                  requiredPermission={
                    PERMISSIONS.PLANNING_VIEW_DISABLED
                  }
                >
                  <DisabledPlanning />
                </PrivatePage>
              }
            />

            {/* La ruta comodín siempre al final */}
            <Route
              path="*"
              element={
                <Navigate
                  to="/"
                  replace
                />
              }
            />
        </Routes>
      </Suspense>

      <MobileBottomNavigationWrapper />
    </Router>
  );
}

export default App;
