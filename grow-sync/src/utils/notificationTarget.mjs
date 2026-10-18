// One destination convention for desktop and mobile notification surfaces.
export function notificationTarget(notification) {
  const type = notification?.type || '';
  if (type.startsWith('planning_') || type === 'state_change') {
    const id = notification?.data?.planning_id;
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? '/planificaciones?planningId=' + encodeURIComponent(id) : '/planificaciones';
  }
  if (type === 'low_stock') return '/inventario';
  if (type === 'new_user') return '/usuarios';
  return null;
}
