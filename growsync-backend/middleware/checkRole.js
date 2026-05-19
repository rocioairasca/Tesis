// NO SE REQUIEREN MODULOS NI VARIABLES DE ENTORNO EN ESTE MIDDLEWARE

const ROLE_NAME = {
  0: "Empleado",
  1: "Supervisor",
  2: "Dueño de campo",
  3: "Admin",
};

/**
 * Middleware de control de acceso por rol numerico
 * - requiredRole: minimo rol requerido (0..3)
 * Requiere q un middleware anterior hata puesto req.user
 */
const checkRole = (requiredRole) => {
  return (req, res, next) => {

    if (!req.user) {
      return res.status(500).json({
        message: "Datos de usuario no disponibles"
      });
    }

    const userRole = Number(req.user.role);

    if (!Number.isFinite(userRole)) {
      return res.status(500).json({
        error: 'ServerError',
        message: 'Rol de usuario inválido'
      });
    }

    if (userRole < requiredRole) {
      return res.status(403).json({
        error: 'Forbidden',
        message: "Acceso denegado",
        currentRole: {
          value: userRole,
          name: ROLE_NAME[userRole] ?? `${userRole}`,
        },
      });
    }

    return next();
  };
};

module.exports = checkRole;