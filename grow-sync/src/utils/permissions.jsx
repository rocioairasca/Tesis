import { ROLE_PERMISSIONS } from "../constants/permissions";

export const getEffectivePermissions = (user) => {
  if (!user) return [];

  if (Array.isArray(user.custom_permissions)) {
    return user.custom_permissions;
  }

  return ROLE_PERMISSIONS[Number(user.role)] || [];
};

export const hasPermission = (user, permission) => {
  if (!permission) return true;

  const permissions = getEffectivePermissions(user);

  return permissions.includes("all") || permissions.includes(permission);
};