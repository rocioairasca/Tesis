import { ROLE_PERMISSIONS } from "../constants/permissions";

// Transitional legacy compatibility: usage.* grants the equivalent recipes.* only.
// Keep persisted custom permissions untouched; recipes.* never grants usage.*.
export const getEffectivePermissions = (user) => {
  if (!user) return [];
  const permissions = Array.isArray(user.custom_permissions)
    ? user.custom_permissions : ROLE_PERMISSIONS[Number(user.role)] || [];
  return [...new Set([...permissions, ...['view', 'create', 'edit', 'disable', 'enable', 'view_disabled']
    .filter(action => permissions.includes('usage.' + action)).map(action => 'recipes.' + action)])];
};

export const hasPermission = (user, permission) => {
  if (!permission) return true;

  const permissions = getEffectivePermissions(user);

  return permissions.includes("all") || permissions.includes(permission);
};