const crypto = require('crypto');
const supabase = require('../../db/supabaseClient');

module.exports = async function inviteUser(req, res) {
    // 1) Verificar que el solicitante sea Supervisor (role 1), Owner (role 2), o Admin (role 3)
    // req.user viene del middleware checkJwt + userData
    const { role, company_id } = req.user;

    if (role !== 1 && role !== 2 && role !== 3) {
        return res.status(403).json({ error: 'Forbidden', message: 'No tienes permisos para invitar usuarios' });
    }

    if (!company_id) {
        return res.status(400).json({ error: 'BadRequest', message: 'Tu usuario no pertenece a ninguna empresa' });
    }

    const { email, role: inviteRole } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'BadRequest', message: 'El email es requerido' });
    }

    // 2) Generar token unico
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Expira en 7 dias

    try {
        // 3) Insertar invitacion
        const { data, error } = await supabase
            .from('invitations')
            .insert([{
                email,
                token,
                company_id,
                role: inviteRole || 0, // 0 por defecto (User)
                expires_at: expiresAt,
                used: false
            }])
            .select()
            .single();

        if (error) {
            console.error('Error creating invitation:', error);
            return res.status(500).json({ error: 'DbError', message: 'Error al crear la invitación' });
        }

        // 4) Retornar el link (o solo el token)
        // En produccion, aqui enviarias un email. Por ahora devolvemos el link.
        // Asumimos que el frontend corre en localhost:3000 o similar, configurable.
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const inviteLink = `${frontendUrl}/login?token=${token}`;

        return res.status(201).json({
            message: 'Invitación creada correctamente',
            inviteLink,
            token,
            invitation: data
        });

    } catch (err) {
        console.error('Invite error:', err);
        return res.status(500).json({ error: 'ServerError', message: 'Error interno al procesar la invitación' });
    }
};
