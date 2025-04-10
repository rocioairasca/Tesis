const { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require("jwks-rsa");

const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://dev-fl08rf2h5payxfcu.us.auth0.com/.well-known/jwks.json`,
  }),
  audience: process.env.AUTH0_API_IDENTIFIER, // desde tu .env
  issuer: `https://dev-fl08rf2h5payxfcu.us.auth0.com/`,
  algorithms: ["RS256"],
});

module.exports = checkJwt;
