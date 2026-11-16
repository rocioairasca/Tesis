const crypto = require('crypto');
const supabase = require('../../db/supabaseClient');
const { getEffectivePermissions, PERMISSIONS } = require('../../constants/permissions');
const schema = require('../../validations/users.schema');

module.exports = async function inviteUser(req, res) {
    res.set('Cache-Control', 'no-store');
    const actor = req.user;
    const permissions = getEffectivePermissions(actor);
    if (!permissions.includes('all') && !permissions.includes(PERMISSIONS.USERS_INVITE)) {
        return res.status(403).json({ error: 'Forbidden', message: 'No tienes permisos para invitar usuarios' });
    }
    const parsed = schema.invite.safeParse({ body: req.body });
    if (!parsed.success) {
        return res.status(400).json({ error: 'ValidationError', message: 'Enviá solamente email válido y rol entero entre 0 y 2' });
    }
    const { email, role: inviteRole } = parsed.data.body;
    const { role, company_id } = actor;
    if (!company_id || !Number.isInteger(role) || role < 0 || role > 3 || inviteRole > role) {
        return res.status(403).json({ error: 'Forbidden', message: 'No puedes invitar ese rol en tu empresa' });
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
                role: inviteRole,
                expires_at: expiresAt,
                used: false
            }])
            .select()
            .single();

        if (error) {
            console.error('Error creating invitation:', { code: error.code });
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
        console.error('Invite error:', { code: err.code });
        return res.status(500).json({ error: 'ServerError', message: 'Error interno al procesar la invitación' });
    }
};
