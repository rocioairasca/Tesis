// Actualiza el rol de un usuario con reglas de seguridad:
//  - Role dentro de 0..3
//  - No permitir que el sistema se quede sin administradores (rol=3)

// IMPORTACION DE CLIENTE SUPABASE
const supabase = require('../../db/supabaseClient');

module.exports = async function updateRole(req, res) {
  try {
    const { id } = req.params;
    const newRole = Number(req.body.role);

    // 1) Validar que el nuevo rol sea un número entero entre 0 y 3
    if (!Number.isInteger(newRole) || newRole < 0 || newRole > 3) {
      return res.status(400).json({ error: 'ValidationError', message: 'role debe estar entre 0 y 3' });
    }

    // 2) Traer usuario destino
    const { data: target, error: fetchErr } = await supabase
      .from('users')
      .select('id,email,full_name,role,enabled')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) {
      console.error('Supabase fetch user error:', fetchErr);
      return res.status(500).json({ error: 'DbError', message: 'Error al buscar usuario' });
    }
    if (!target) {
      return res.status(404).json({ error: 'NotFound', message: 'Usuario no encontrado' });
    }

    // 3) Si no hay cambio, devolver 200 sin tocar BD
    if (Number(target.role) === newRole) {
      return res.status(200).json({
        message: 'Sin cambios (el rol ya coincide)',
        user: target,
      });
    }

    // 4) Regla: evitar quedarse sin Admins
    // Si estamos bajando de Admin (3) a algo menor, verificar que exista otro Admin activo.
    const demotingFromAdmin = Number(target.role) === 3 && newRole < 3;
    if (demotingFromAdmin) {
      const { count, error: countErr } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 3)
        .eq('enabled', true)
        .neq('id', target.id); // otros admins

      if (countErr) {
        console.error('Supabase count admins error:', countErr);
        return res.status(500).json({ error: 'DbError', message: 'Error verificando administradores' });
      }
      if (!count || count < 1) {
        return res.status(409).json({
          error: 'LastAdminError',
          message: 'No se puede descender el rol: el sistema no puede quedarse sin administradores',
        });
      }
    }

    // 5) Actualizar rol
    const { data: updated, error: updErr } = await supabase
      .from('users')
      .update({ role: newRole })
      .eq('id', id)
      .select('id,email,full_name,role,enabled')
      .maybeSingle();

    if (updErr) {
      console.error('Supabase update role error:', updErr);
      return res.status(500).json({ error: 'DbError', message: 'Error al actualizar el rol' });
    }
    if (!updated) {
      // Muy raro: no se encontro tras update
      return res.status(404).json({ error: 'NotFound', message: 'Usuario no encontrado tras actualizar' });
    }

    return res.status(200).json({
      message: 'Rol actualizado correctamente',
      user: updated,
    });
  } catch (err) {
    console.error('Unexpected updateRole error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Error al actualizar el rol' });
  }
};