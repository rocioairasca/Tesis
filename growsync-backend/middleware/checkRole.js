// NO SE REQUIEREN MODULOS NI VARIABLES DE ENTORNO EN ESTE MIDDLEWARE

/**
 * Middleware de control de acceso por rol numerico
 * - requiredRole: minimo rol requerido (0..3)
 * Requiere q un middleware anterior hata puesto req.user
 */
const checkRole = (requiredRole) => {
  return (req, res, next) => {
    // si no hay usuario, es un problema de autenticacion (no del servidor)
    if (!req.user) {
      return res.status(500).json({ message: "Datos de usuario no disponibles" });
    }

    // Fuerza a número por si viene como string
    const userRole = Number(req.user.role);

    // Si el role no es numérico válido, es un mal dato de la BD
    if (!Number.isFinite(userRole)) {
      return res.status(500).json({ error: 'ServerError', message: 'Rol de usuario inválido' });
    }

    // chequeo de autorizacion
    if (userRole < requiredRole) {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: "Acceso denegado",
        currentRole: { value: userRole, name: ROLE_NAME[userRole] ?? `${userRole}` },
      });
    }

    // todo ok
    return next();
  };
};

// EXPORTAMOS EL MIDDLEWARE PARA PODER USARLO EN EL PROYECTO
module.exports = checkRole;

