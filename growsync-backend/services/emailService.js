const axios = require('axios');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildCompanyInvitationEmail({ companyName, inviteLink }) {
  const safeCompanyName = escapeHtml(companyName);
  const safeInviteLink = escapeHtml(inviteLink);

  return {
    subject: 'Invitación a GrowSync',
    html: `
      <div style="font-family: Arial, sans-serif; color: #1f2933; line-height: 1.5; max-width: 560px; margin: 0 auto;">
        <h1 style="font-size: 22px; color: #437118; margin-bottom: 16px;">Invitación a GrowSync</h1>
        <p>Hola,</p>
        <p>Fuiste invitada a crear la cuenta administradora de <strong>${safeCompanyName}</strong> en GrowSync.</p>
        <p>Para completar el registro, abrí el siguiente enlace:</p>
        <p style="margin: 28px 0;">
          <a href="${safeInviteLink}" style="background: #437118; color: #ffffff; padding: 12px 18px; border-radius: 6px; text-decoration: none; display: inline-block;">
            Crear cuenta administradora
          </a>
        </p>
        <p>Si el botón no funciona, copiá y pegá este enlace en tu navegador:</p>
        <p><a href="${safeInviteLink}">${safeInviteLink}</a></p>
        <p style="color: #52606d;">Este enlace vence en 7 días.</p>
      </div>
    `,
    text: [
      'Invitación a GrowSync',
      '',
      `Fuiste invitada a crear la cuenta administradora de ${companyName} en GrowSync.`,
      '',
      `Abrí este enlace para completar el registro: ${inviteLink}`,
      '',
      'Este enlace vence en 7 días.',
    ].join('\n'),
  };
}

async function sendCompanyInvitationEmail({ to, companyName, inviteLink }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    const error = new Error('Faltan RESEND_API_KEY o EMAIL_FROM');
    error.code = 'EmailNotConfigured';
    throw error;
  }

  const email = buildCompanyInvitationEmail({ companyName, inviteLink });

  const { data } = await axios.post(
    'https://api.resend.com/emails',
    {
      from,
      to: [to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    },
    {
      timeout: 10000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return data;
}

module.exports = {
  sendCompanyInvitationEmail,
};
