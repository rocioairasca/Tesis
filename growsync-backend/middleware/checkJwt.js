// Verificacion de JWT por Auth0 usando JWKS
// Pone el payload decodificado en req.auth

// IMPORTACION DE MODULOS JWT Y VARIABLES DE ENTORNO
const { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require("jwks-rsa");
require("dotenv").config();

/**
 * ENV requeridas:
 *  AUTH0_API_AUDIENCE: El identificador de la API que se esta protegiendo
 *  AUTH0_DOMAIN: El dominio de Auth0 
 */

const DOMAIN = process.env.AUTH0_DOMAIN;
const AUDIENCE = process.env.AUTH0_API_AUDIENCE;

if (!DOMAIN || !AUDIENCE) {
  console.warn(
    "Falta definir las variables de entorno AUTH0_DOMAIN y AUTH0_API_AUDIENCE"
  );
}

const ISSUER = `https://${DOMAIN}/`;
const JWKS_URI = `https://${DOMAIN}/.well-known/jwks.json`;

// DEFINIMOS Y CONFIGURAMOS EL MIDDLEWARE checkJwt
// Este se vale del modulo jwksRsa para obtener las claves publicas del servidor de auth0 para verificar los tokens que vienen encriptados en RS256
const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: JWKS_URI,
  }),
  audience: AUDIENCE, 
  issuer: ISSUER,
  algorithms: ["RS256"],
  requestProperty: "auth", // El payload decodificado se guardara en req.auth
});

// EXPORTAMOS EL MIDDLEWARE PARA PODER USARLO EN EL PROYECTO
module.exports = checkJwt;
