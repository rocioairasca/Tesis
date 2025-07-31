// IMPORTACION DE CLIENTE SUPABASE
const supabase = require('../../db/supabaseClient');

// DECLARAMOS UNA FUNCIÓN updateRole - usa el ID de usuario para editar el valor role en la BD
const updateRole = async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    try {
        // Actualizar el rol del usuario en Supabase
        const { data, error } = await supabase
            .from('users')
            .update({ role })
            .eq('id', id)
            .select()
            .single(); // Queremos solo un registro actualizado

        if (error && error.code === 'PGRST116') { // No encontrado
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }
        if (error) {
            console.error("Error al actualizar rol en Supabase:", error);
            return res.status(500).json({ message: 'Error al actualizar el rol', error: error.message });
        }

        res.status(200).json({
            message: 'Rol actualizado correctamente',
            user: data,
        });

    } catch (error) {
        console.error("Error inesperado:", error);
        res.status(500).json({
            message: 'Error al actualizar el rol',
            error: error.message,
        });
    }
};

// EXPORTAMOS LA FUNCIÓN PARA SER USADA EN UNA RUTA (routes/userRoutes.js)
module.exports = updateRole;
