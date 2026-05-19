const supabase = require('../../db/supabaseClient');

module.exports = async function updatePermissions(req, res, next) {
    try { 
        const { id } = req.params;
        const { custom_permissions } = req.body;

        if (
            custom_permissions !== null &&
            !Array.isArray(custom_permissions)
        ) {
            return res.status(400).json({
                error: 'ValidationError',
                message: 'custom_permissions debe ser un array de strings o null',
            });
        }

        const { data: target, error: fetchErr } = await supabase
            .from('users')
            .select('id,email,role,company_id,custom_permissions')
            .eq('id', id)
            .maybeSingle();
        
        if (fetchErr) throw fetchErr;

        if (!target) {
            return res.status(404).json({
                error: 'NotFound',
                message: 'Usuario no encontrado',
            });
        }
        
        if (target.company_id !== req.user.company_id) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'No tienes permiso para modificar este usuario',
            });
        }

        if (Number(target.role) === 3) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'No se pueden modificar los permisos de un usuario con rol Admin',
            });
        }

        const { data: updated, error: updErr } = await supabase
            .from('users')
            .update({ custom_permissions })
            .eq('id', id)
            .select('id,email,full_name,role,enabled,company_id,custom_permissions')
            .maybeSingle();

        if (updErr) throw updErr;

        return res.json({
            message: 'Permisos actualizados exitosamente',
            user: updated,
        });
            
    } catch (err) {
        next(err);
    }
};