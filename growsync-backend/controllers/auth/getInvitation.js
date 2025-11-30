const supabase = require('../../db/supabaseClient');

/**
 * GET /api/invitations/:token
 * Obtiene información básica de una invitación (solo email)
 * Endpoint público para autocompletar el formulario de registro
 */
module.exports = async function getInvitation(req, res) {
    const { token } = req.params;

    if (!token) {
        return res.status(400).json({ error: 'BadRequest', message: 'Token requerido' });
    }

    try {
        const { data: invite, error } = await supabase
            .from('invitations')
            .select('email')
            .eq('token', token)
            .eq('used', false)
            .gt('expires_at', new Date().toISOString())
            .single();

        if (error || !invite) {
            return res.status(404).json({ error: 'NotFound', message: 'Invitación no encontrada o expirada' });
        }

        return res.status(200).json({
            email: invite.email
        });

    } catch (err) {
        console.error('Get invitation error:', err);
        return res.status(500).json({ error: 'ServerError', message: 'Error al obtener la invitación' });
    }
};
