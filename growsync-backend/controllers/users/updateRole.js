const pool = require('../../db/connection');

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

module.exports = updateRole;