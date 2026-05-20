/**
 * Componente: Tabla de Usuarios
 * Ubicación: src/components/users/UserTable.js
 * Descripción:
 *  Renderiza la lista de usuarios y permite la gestión rápida de roles.
 *  Incluye lógica de actualización optimista (optimistic updates) para mejorar la UX.
 * 
 * Funcionalidad:
 *  - Listado de usuarios con paginación.
 *  - Cambio de rol directo desde la tabla.
 */
import React, { useEffect, useState } from "react";
import { 
  Table, 
  Select, 
  message,
  Button,
  Drawer,
  Checkbox,
  Space,
  Divider,
} from "antd";
import api from "../../services/apiClient";
import {
  updateUserPermissions,
} from '../../services/authService';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../../constants/permissions';
import { hasPermission } from "../../utils/permissions";

const ROLE_OPTIONS = [
  { value: 0, label: "Empleado" },
  { value: 1, label: "Supervisor" },
  { value: 2, label: "Dueño de Campo" },
  { value: 3, label: "Admin" },
];

const PERMISSION_GROUPS = {
    Planificaciones: [
    PERMISSIONS.PLANNING_VIEW,
    PERMISSIONS.PLANNING_CREATE,
    PERMISSIONS.PLANNING_EDIT,
    PERMISSIONS.PLANNING_DISABLE,
    PERMISSIONS.PLANNING_ENABLE,
    PERMISSIONS.PLANNING_VIEW_DISABLED,
  ],

  Inventario: [
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.INVENTORY_VIEW_DISABLED,
    PERMISSIONS.INVENTORY_CREATE,
    PERMISSIONS.INVENTORY_EDIT,
    PERMISSIONS.INVENTORY_DISABLE,
    PERMISSIONS.INVENTORY_ENABLE,
  ],

  Lotes: [
    PERMISSIONS.LOTS_VIEW,
    PERMISSIONS.LOTS_VIEW_DISABLED,
    PERMISSIONS.LOTS_CREATE,
    PERMISSIONS.LOTS_EDIT,
    PERMISSIONS.LOTS_DISABLE,
    PERMISSIONS.LOTS_ENABLE,
  ],

  Uso: [
    PERMISSIONS.USAGE_VIEW,
    PERMISSIONS.USAGE_VIEW_DISABLED,
    PERMISSIONS.USAGE_CREATE,
    PERMISSIONS.USAGE_EDIT,
    PERMISSIONS.USAGE_DISABLE,
    PERMISSIONS.USAGE_ENABLE,
  ],

  Cosecha: [
    PERMISSIONS.HARVEST_VIEW,
    PERMISSIONS.HARVEST_VIEW_DISABLED,
    PERMISSIONS.HARVEST_CREATE,
    PERMISSIONS.HARVEST_EDIT,
    PERMISSIONS.HARVEST_DISABLE,
    PERMISSIONS.HARVEST_ENABLE,
  ],

    Vehículos: [
    PERMISSIONS.VEHICLES_VIEW,
    PERMISSIONS.VEHICLES_VIEW_DISABLED,
    PERMISSIONS.VEHICLES_CREATE,
    PERMISSIONS.VEHICLES_EDIT,
    PERMISSIONS.VEHICLES_DISABLE,
    PERMISSIONS.VEHICLES_ENABLE,
  ],
};

const PERMISSION_LABELS = {
  // Planificaciones
  [PERMISSIONS.PLANNING_VIEW]: "Ver planificaciones",
  [PERMISSIONS.PLANNING_VIEW_DISABLED]: "Ver planificaciones deshabilitadas",
  [PERMISSIONS.PLANNING_CREATE]: "Crear planificaciones",
  [PERMISSIONS.PLANNING_EDIT]: "Editar planificaciones",
  [PERMISSIONS.PLANNING_DISABLE]: "Deshabilitar planificaciones",
  [PERMISSIONS.PLANNING_ENABLE]: "Restaurar planificaciones",

  // Inventario
  [PERMISSIONS.INVENTORY_VIEW]: "Ver inventario",
  [PERMISSIONS.INVENTORY_VIEW_DISABLED]: "Ver productos deshabilitados",
  [PERMISSIONS.INVENTORY_CREATE]: "Crear productos",
  [PERMISSIONS.INVENTORY_EDIT]: "Editar productos",
  [PERMISSIONS.INVENTORY_DISABLE]: "Deshabilitar productos",
  [PERMISSIONS.INVENTORY_ENABLE]: "Restaurar productos",

  // Lotes
  [PERMISSIONS.LOTS_VIEW]: "Ver lotes",
  [PERMISSIONS.LOTS_VIEW_DISABLED]: "Ver lotes deshabilitados",
  [PERMISSIONS.LOTS_CREATE]: "Crear lotes",
  [PERMISSIONS.LOTS_EDIT]: "Editar lotes",
  [PERMISSIONS.LOTS_DISABLE]: "Deshabilitar lotes",
  [PERMISSIONS.LOTS_ENABLE]: "Restaurar lotes",

  // Uso
  [PERMISSIONS.USAGE_VIEW]: "Ver registros de uso",
  [PERMISSIONS.USAGE_VIEW_DISABLED]: "Ver registros deshabilitados",
  [PERMISSIONS.USAGE_CREATE]: "Crear registros de uso",
  [PERMISSIONS.USAGE_EDIT]: "Editar registros de uso",
  [PERMISSIONS.USAGE_DISABLE]: "Deshabilitar registros de uso",
  [PERMISSIONS.USAGE_ENABLE]: "Restaurar registros de uso",

  // Cosecha
  [PERMISSIONS.HARVEST_VIEW]: "Ver cosechas",
  [PERMISSIONS.HARVEST_VIEW_DISABLED]: "Ver cosechas deshabilitadas",
  [PERMISSIONS.HARVEST_CREATE]: "Crear cosechas",
  [PERMISSIONS.HARVEST_EDIT]: "Editar cosechas",
  [PERMISSIONS.HARVEST_DISABLE]: "Deshabilitar cosechas",
  [PERMISSIONS.HARVEST_ENABLE]: "Restaurar cosechas",

  // Vehículos
  [PERMISSIONS.VEHICLES_VIEW]: "Ver vehículos",
  [PERMISSIONS.VEHICLES_VIEW_DISABLED]: "Ver vehículos deshabilitados",
  [PERMISSIONS.VEHICLES_CREATE]: "Crear vehículos",
  [PERMISSIONS.VEHICLES_EDIT]: "Editar vehículos",
  [PERMISSIONS.VEHICLES_DISABLE]: "Deshabilitar vehículos",
  [PERMISSIONS.VEHICLES_ENABLE]: "Restaurar vehículos",
};

const UserTable = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  const [permissionsDrawerOpen, setPermissionsDrawerOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedPermissions, setSelectedPermissions] = useState([]);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");
  const canChangeRole = hasPermission(currentUser, PERMISSIONS.USERS_CHANGE_ROLE);
  const canManagePermissions = hasPermission(currentUser, PERMISSIONS.USERS_PERMISSIONS);

  // helpers de id/rowKey robustos
  const getId = (r) => r?.id ?? r?._id;
  const rowKey = (r) => getId(r) ?? r?.email;

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/users"); // baseURL ya incluye /api
      // tolerante a distintos shapes
      const list = Array.isArray(data) ? data : data?.items || data?.data || [];
      setUsers(list);
    } catch (err) {
      console.error("→ users list error:", err);
      message.error(err?.response?.data?.message || "No se pudo cargar usuarios");
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    setUpdatingId(userId);

    // Optimistic update + rollback si falla
    const prev = users;
    setUsers((arr) =>
      arr.map((u) => (getId(u) === userId ? { ...u, role: newRole, custom_permissions: null } : u))
    );

    try {
      await api.put(`/users/${userId}/role`, { role: newRole });

      await api.put(`/users/${userId}/permissions`, {
        custom_permissions: null,
      });

      message.success("Rol actualizado");
    } catch (err) {
      console.error("→ update role error:", err);
      setUsers(prev); // rollback
      message.error(err?.response?.data?.message || "No se pudo actualizar el rol");
    } finally {
      setUpdatingId(null);
    }
  };

  const openPermissionsDrawer = (user) => {
    setSelectedUser(user);
    
    const permissionsToShow = Array.isArray(user.custom_permissions)
      ? user.custom_permissions
      : ROLE_PERMISSIONS[Number(user.role)] || [];

    setSelectedPermissions(permissionsToShow);

    setPermissionsDrawerOpen(true);
  };

  const handleSavePermissions = async () => {
    if (!selectedUser) return;

    try {
      setSavingPermissions(true);

      await updateUserPermissions(
        getId(selectedUser),
        selectedPermissions
      );

      setUsers((prev) =>
        prev.map((u) =>
          getId(u) === getId(selectedUser)
            ? { ...u, custom_permissions: selectedPermissions }
            : u
        )
      );

      message.success("Permisos actualizados");
      setPermissionsDrawerOpen(false);
    } catch (err) {
      console.error(err);
      message.error(
        err?.message || "No se pudieron actualizar los permisos"
      );
    } finally {
      setSavingPermissions(false);
    }
  };
      

  const columns = [
    { title: "Email", dataIndex: "email", key: "email" },
    {
      title: "Rol",
      dataIndex: "role",
      key: "role",
      render: (role, record) => (
        <Select
          value={role}
          options={ROLE_OPTIONS}            // ✅ AntD v5: usar options, no <Option>
          style={{ minWidth: 180 }}
          disabled={!canChangeRole}
          loading={updatingId === getId(record)}
          onChange={(value) => handleRoleChange(getId(record), value)}
        />
      ),
    },
    {
      title: "Acciones",
      key: "actions",
      render: (_, record) => (
        <Space>
          {canManagePermissions && Number(record.role) !== 3&& (
            <Button onClick={() => openPermissionsDrawer(record)}>
              Permisos
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Table
        dataSource={users}
        columns={columns}
        loading={loading}
        rowKey={rowKey}
        pagination={{ position: ["bottomCenter"] }}
        scroll={{ x: "max-content" }}
      />

      <Drawer
        title={
          selectedUser
          ? `Permisos - ${selectedUser.email}`
          : "Permisos"
        }
        open={permissionsDrawerOpen}
        onClose={() => setPermissionsDrawerOpen(false)}
        width={420}
      >
        {Object.entries(PERMISSION_GROUPS).map(
          ([groupName, permissions]) => (
            <div key={groupName}>
              <Divider orientation="left">
                {groupName}
              </Divider>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {permissions.map((permission) => (
                  <Checkbox
                    key={permission}
                    checked={selectedPermissions.includes(permission)}
                    onChange={(e) => {
                      const checked = e.target.checked;

                      setSelectedPermissions((prev) => {
                        if (checked) {
                          return prev.includes(permission)
                            ? prev
                            : [...prev, permission];
                        }

                        return prev.filter((p) => p !== permission);
                      });
                    }}
                  >
                    {PERMISSION_LABELS[permission] || permission}
                  </Checkbox>
                ))}
              </div>
            </div>
          )
        )}

        <div style={{ marginTop: 24 }}>
          <Button
            type="primary"
            block
            loading={savingPermissions}
            onClick={handleSavePermissions}
          >
            Guardar Permisos
          </Button>
        </div>
      </Drawer>
    </div>
  );
};

export default UserTable;

