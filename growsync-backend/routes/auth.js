const router = require('express').Router();

// Controladores
const registerUser = require('../controllers/auth/registerUser');
const loginUser = require('../controllers/auth/loginUser');

// Middlewares
const validate = require('../middleware/validate');
const schema = require('../validations/auth.schema');

// Rutas publicas (no pasan por checkJwt ni userData)
// Montadas en index.js con: app.use('/api', authRoutes)
// => Quedan como /api/register y /api/login

// Registro local
router.post('/register',
  validate(schema.register),
  registerUser
);

// Login local
router.post('/login',
  validate(schema.login),
  loginUser
);

module.exports = router;
