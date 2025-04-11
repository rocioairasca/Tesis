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

module.exports = checkRole;

