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
import { Table, Select, message } from "antd";
import api from "../../services/apiClient";

const ROLE_OPTIONS = [
  { value: 0, label: "Empleado" },
  { value: 1, label: "Supervisor" },
  { value: 2, label: "Dueño de Campo" },
  { value: 3, label: "Admin" },
];

const UserTable = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

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
      arr.map((u) => (getId(u) === userId ? { ...u, role: newRole } : u))
    );

    try {
      await api.put(`/users/${userId}/role`, { role: newRole });
      message.success("Rol actualizado");
    } catch (err) {
      console.error("→ update role error:", err);
      setUsers(prev); // rollback
      message.error(err?.response?.data?.message || "No se pudo actualizar el rol");
    } finally {
      setUpdatingId(null);
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
          loading={updatingId === getId(record)}
          onChange={(value) => handleRoleChange(getId(record), value)}
        />
      ),
    },
  ];

  return (
    <Table
      dataSource={users}
      columns={columns}
      loading={loading}
      rowKey={rowKey}
      pagination={{ position: ["bottomCenter"] }}
      scroll={{ x: "max-content" }}
    />
  );
};

export default UserTable;

