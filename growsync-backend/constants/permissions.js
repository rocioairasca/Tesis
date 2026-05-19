const PERMISSIONS = {
    // Planificaciones
  PLANNING_VIEW: "planning.view",
  PLANNING_CREATE: "planning.create",
  PLANNING_EDIT: "planning.edit",
  PLANNING_DISABLE: "planning.disable",
  PLANNING_ENABLE: "planning.enable",
  PLANNING_VIEW_DISABLED: "planning.view_disabled",

  // Inventario
  INVENTORY_VIEW: "inventory.view",
  INVENTORY_CREATE: "inventory.create",
  INVENTORY_EDIT: "inventory.edit",
  INVENTORY_DISABLE: "inventory.disable",
  INVENTORY_ENABLE: "inventory.enable",
  INVENTORY_VIEW_DISABLED: "inventory.view_disabled",

  // Lotes
  LOTS_VIEW: "lots.view",
  LOTS_CREATE: "lots.create",
  LOTS_EDIT: "lots.edit",
  LOTS_DISABLE: "lots.disable",
  LOTS_ENABLE: "lots.enable",
  LOTS_VIEW_DISABLED: "lots.view_disabled",

  // Registros de uso
  USAGE_VIEW: "usage.view",
  USAGE_CREATE: "usage.create",
  USAGE_EDIT: "usage.edit",
  USAGE_DISABLE: "usage.disable",
  USAGE_ENABLE: "usage.enable",
  USAGE_VIEW_DISABLED: "usage.view_disabled",

  // Cosechas
  HARVEST_VIEW: "harvest.view",
  HARVEST_CREATE: "harvest.create",
  HARVEST_EDIT: "harvest.edit",
  HARVEST_DISABLE: "harvest.disable",
  HARVEST_ENABLE: "harvest.enable",
  HARVEST_VIEW_DISABLED: "harvest.view_disabled",

  // Vehiculos
  VEHICLES_VIEW: "vehicles.view",
  VEHICLES_CREATE: "vehicles.create",
  VEHICLES_EDIT: "vehicles.edit",
  VEHICLES_DISABLE: "vehicles.disable",
  VEHICLES_ENABLE: "vehicles.enable",
  VEHICLES_VIEW_DISABLED: "vehicles.view_disabled",

  // Usuarios
  USERS_VIEW: "users.view",
  USERS_INVITE: "users.invite",
  USERS_CHANGE_ROLE: "users.changeRole",
  USERS_PERMISSIONS: "users.permissions",
};

const ROLE_PERMISSIONS = {
  0: [
      PERMISSIONS.PLANNING_VIEW,
  
      PERMISSIONS.INVENTORY_VIEW,
  
      PERMISSIONS.LOTS_VIEW,
  
      PERMISSIONS.USAGE_CREATE,
  
      PERMISSIONS.VEHICLES_VIEW,
    ],
  
    1: [
      PERMISSIONS.PLANNING_VIEW,
  
      PERMISSIONS.INVENTORY_VIEW,
  
      PERMISSIONS.LOTS_VIEW,
  
      PERMISSIONS.USAGE_VIEW,
      PERMISSIONS.USAGE_CREATE,
      PERMISSIONS.USAGE_EDIT,
  
      PERMISSIONS.HARVEST_VIEW,
      PERMISSIONS.HARVEST_CREATE,
  
      PERMISSIONS.VEHICLES_VIEW,
    ],
  
    2: [
      PERMISSIONS.PLANNING_VIEW,
      PERMISSIONS.PLANNING_CREATE,
      PERMISSIONS.PLANNING_EDIT,
      PERMISSIONS.PLANNING_DISABLE,
      PERMISSIONS.PLANNING_ENABLE,
      PERMISSIONS.PLANNING_VIEW_DISABLED,
  
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.INVENTORY_CREATE,
      PERMISSIONS.INVENTORY_EDIT,
      PERMISSIONS.INVENTORY_DISABLE,
      PERMISSIONS.INVENTORY_ENABLE,
      PERMISSIONS.INVENTORY_VIEW_DISABLED,
  
      PERMISSIONS.LOTS_VIEW,
      PERMISSIONS.LOTS_CREATE,
      PERMISSIONS.LOTS_EDIT,
      PERMISSIONS.LOTS_DISABLE,
      PERMISSIONS.LOTS_ENABLE,
      PERMISSIONS.LOTS_VIEW_DISABLED,
  
      PERMISSIONS.USAGE_VIEW,
      PERMISSIONS.USAGE_CREATE,
      PERMISSIONS.USAGE_EDIT,
      PERMISSIONS.USAGE_DISABLE,
      PERMISSIONS.USAGE_ENABLE,
      PERMISSIONS.USAGE_VIEW_DISABLED,
  
      PERMISSIONS.HARVEST_VIEW,
      PERMISSIONS.HARVEST_CREATE,
      PERMISSIONS.HARVEST_EDIT,
      PERMISSIONS.HARVEST_DISABLE,
      PERMISSIONS.HARVEST_ENABLE,
      PERMISSIONS.HARVEST_VIEW_DISABLED,
  
      PERMISSIONS.VEHICLES_VIEW,
      PERMISSIONS.VEHICLES_CREATE,
      PERMISSIONS.VEHICLES_EDIT,
      PERMISSIONS.VEHICLES_DISABLE,
      PERMISSIONS.VEHICLES_ENABLE,
      PERMISSIONS.VEHICLES_VIEW_DISABLED,
    ],
  
    3: ["all"],
};

const getDefaultPermissionsByRole = (role) => {
  return ROLE_PERMISSIONS[Number(role)] || [];
};

const getEffectivePermissions = (user) => {
  if (Array.isArray(user.custom_permissions)) {
    return user.custom_permissions;
  }

  return getDefaultPermissionsByRole(user.role);
};

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  getDefaultPermissionsByRole,
  getEffectivePermissions,
};