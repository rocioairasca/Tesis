const { z } = require('zod');

const Email = z.string().trim().toLowerCase().email('Email inválido');
const Password = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres');

exports.register = z.object({
  body: z.object({
    email: Email,
    password: Password,
    full_name: z.string().trim().min(1, 'Nombre requerido').optional(),
    token: z.string().min(1, 'Token requerido'),
  }),
});

exports.login = z.object({
  body: z.object({
    email: Email,
    password: z.string().min(1, 'Contraseña requerida'),
  }),
});
