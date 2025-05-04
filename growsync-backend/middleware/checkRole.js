// NO SE REQUIEREN MODULOS NI VARIABLES DE ENTORNO EN ESTE MIDDLEWARE

// DEFINIMOS Y CONFIGURAMOS EL MIDDLEWARE checkRole
// Este middleware concede o restringe el acceso al usuario a un determinado recurso en funcion de un entero asignado en la BD que representa su rol
const checkRole = (requiredRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(500).json({ message: "Datos de usuario no disponibles" });
    }

    if (req.user.role < requiredRole) {
      return res.status(403).json({ message: "Acceso denegado" });
    }

    next();
  };
};

// EXPORTAMOS EL MIDDLEWARE PARA PODER USARLO EN EL PROYECTO
module.exports = checkRole;

