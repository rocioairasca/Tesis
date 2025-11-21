/**
 * Feature: Gestión de Usuarios
 * Ubicación: src/features/users/Users.js
 * Descripción:
 *  Vista principal para la administración de usuarios del sistema.
 *  Actualmente actúa como un contenedor (wrapper) para el componente UserTable.
 * 
 * Notas:
 *  - Se mantiene simple para facilitar futuras expansiones (ej: agregar filtros o métricas).
 */
import React from "react";
import UserTable from "../../components/users/UserTable";

const Users = () => {
  return (
    <div>
      <h1>Gestión de Usuarios</h1>
      <UserTable />
    </div>
  );
};

export default Users;
