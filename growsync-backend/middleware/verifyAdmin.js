const verifyAdmin = (req, res, next) => {
    if (req.user.role < 3) {
        return res.status(403).json({ message: 'Acceso denegado. Solo administradores pueden acceder a esta ruta.' });
    }
    next();
};

module.exports = verifyAdmin;