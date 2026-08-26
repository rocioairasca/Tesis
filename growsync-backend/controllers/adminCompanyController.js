const crypto = require('crypto');
const supabase = require('../db/supabaseClient');
const { pool } = require('../db/supabaseClient');
const { sendCompanyInvitationEmail } = require('../services/emailService');

function normalizeFrontendUrl(req) {
    const origin = req.get('origin');
    return (process.env.FRONTEND_URL || origin || 'https://growsync.com.ar').replace(/\/+$/, '');
}

function normalizeComparable(value) {
    return String(value || '').trim().toLowerCase();
}

function publicInvitation(invitation) {
    return {
        id: invitation.id,
        email: invitation.email,
        company_id: invitation.company_id,
        role: invitation.role,
        expires_at: invitation.expires_at,
        used: invitation.used,
    };
}

async function respondWithInvitationEmail(req, res, {
    statusWhenSent,
    messageWhenSent,
    messageWhenEmailFails,
    company,
    invitation,
}) {
    const inviteLink = `${normalizeFrontendUrl(req)}/login?token=${invitation.token}`;

    try {
        const emailResult = await sendCompanyInvitationEmail({
            to: invitation.email,
            companyName: company.name,
            inviteLink,
        });

        return res.status(statusWhenSent).json({
            message: messageWhenSent,
            company,
            invitation: publicInvitation(invitation),
            inviteLink,
            email: {
                sent: true,
                provider: 'resend',
                id: emailResult?.id || null,
            },
        });
    } catch (emailError) {
        console.error('Error enviando invitacion por email:', emailError.response?.data || emailError.message);

        return res.status(202).json({
            message: messageWhenEmailFails,
            company,
            invitation: publicInvitation(invitation),
            inviteLink,
            email: {
                sent: false,
                provider: 'resend',
                error: emailError.code || emailError.response?.data?.message || emailError.message,
            },
        });
    }
}

const createCompanyInvitation = async (req, res) => {
    try {
        const { companyName, email, plan } = req.body;
        const normalizedEmail = email.toLowerCase().trim();
        const normalizedCompanyName = companyName.trim();

        if (!pool) {
            return res.status(500).json({
                error: 'ServerConfig',
                message: 'Falta SUPABASE_DB_URL/DATABASE_URL para crear empresa e invitacion en una transaccion',
            });
        }

        const existingUser = await supabase
            .from('users')
            .select('id')
            .eq('email', normalizedEmail)
            .maybeSingle();

        if (existingUser.error) {
            throw existingUser.error;
        }
        if (existingUser.data) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'Ya existe un usuario con ese email',
            });
        }

        const existingInvitation = await supabase
            .from('invitations')
            .select('*, companies(*)')
            .eq('email', normalizedEmail)
            .eq('used', false)
            .gt('expires_at', new Date().toISOString())
            .maybeSingle();

        if (existingInvitation.error) {
            throw existingInvitation.error;
        }
        if (existingInvitation.data) {
            const invitedCompany = existingInvitation.data.companies;

            if (
                invitedCompany &&
                normalizeComparable(invitedCompany.name) === normalizeComparable(normalizedCompanyName)
            ) {
                const { companies: _companies, ...invitation } = existingInvitation.data;

                return respondWithInvitationEmail(req, res, {
                    statusWhenSent: 200,
                    messageWhenSent: 'La invitacion ya existia. Email reenviado.',
                    messageWhenEmailFails: 'La invitacion ya existia, pero no se pudo enviar el email',
                    company: invitedCompany,
                    invitation,
                });
            }

            return res.status(409).json({
                error: 'Conflict',
                message: 'Ya existe una invitacion vigente para ese email asociada a otra empresa',
            });
        }

        const client = await pool.connect();
        let company;
        let invitation;
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        try {
            await client.query('BEGIN');

            const existingCompany = await client.query(
                'SELECT id FROM companies WHERE lower(name) = lower($1) LIMIT 1',
                [normalizedCompanyName]
            );

            if (existingCompany.rows.length) {
                const usersInCompany = await client.query(
                    'SELECT id FROM users WHERE company_id = $1 LIMIT 1',
                    [existingCompany.rows[0].id]
                );

                if (usersInCompany.rows.length) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        error: 'Conflict',
                        message: 'Ya existe una empresa con ese nombre y usuarios asociados',
                    });
                }

                const companyResult = await client.query(
                    `UPDATE companies
                    SET plan = $2,
                        subscription_status = 'active',
                        subscription_started_at = COALESCE(subscription_started_at, NOW()),
                        subscription_expires_at = NULL,
                        subscription_source = 'manual'
                    WHERE id = $1
                    RETURNING *`,
                    [existingCompany.rows[0].id, plan]
                );
                company = companyResult.rows[0];
            } else {
                const companyResult = await client.query(
                    `INSERT INTO companies (
                        name,
                        plan,
                        subscription_status,
                        subscription_started_at,
                        subscription_expires_at,
                        subscription_source
                    )
                    VALUES ($1, $2, 'active', NOW(), NULL, 'manual')
                    RETURNING *`,
                    [normalizedCompanyName, plan]
                );
                company = companyResult.rows[0];
            }

            const invitationResult = await client.query(
                `INSERT INTO invitations (email, token, company_id, role, expires_at, used)
                VALUES ($1, $2, $3, 3, $4, false)
                RETURNING *`,
                [normalizedEmail, token, company.id, expiresAt]
            );
            invitation = invitationResult.rows[0];

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

        return respondWithInvitationEmail(req, res, {
            statusWhenSent: 201,
            messageWhenSent: 'Empresa e invitacion creadas correctamente. Email enviado.',
            messageWhenEmailFails: 'Empresa e invitacion creadas, pero no se pudo enviar el email',
            company,
            invitation,
        });

    } catch (error) {
        console.error('Error creando invitacion de empresa:', error);

        return res.status(500).json({
            error: 'InternalServerError',
            message: 'No se pudo crear la invitacion de empresa',
        });
    }
};

module.exports = {
    createCompanyInvitation,
};
