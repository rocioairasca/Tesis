// IMPORTACION DE POOL DE BD
const pool = require('../../db/connection');

// DECLARAMOS UNA FUNCION updateRole - se vale del ID de usuario para editar el valor role de la BD correspondiente a ese ID
const updateRole = async (req, res) => {
    const {id} = req.params;
    const { role } = req.body;

    try {
        const result = await pool.query(
            `UPDATE users SET role = $1 WHERE id = $2 RETURNING *`,
            [role, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        res.status(200).json({
            message: 'Rol actualizado correctamente',
            user: result.rows[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Error al actualizar el rol',
            error: error.message,
        });
    }
};

// EXPORTAMOS LA FUNCION PARA SER USADA EN UNA RUTA (routes/userRoutes.js)
module.exports = updateRole;