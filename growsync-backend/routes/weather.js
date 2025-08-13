const router = require('express').Router();
const { fetchWeather, getLatestWeather } = require('../controllers/openWeatherMap');

const validate  = require('../middleware/validate');
const checkRole = require('../middleware/checkRole');
const schema    = require('../validations/weather.schema');

/**
 * Roles:
 *  0 = Empleado (logueado)
 *  1 = Supervisor
 *  2 = Dueño
 *  3 = Admin
 *
 * Criterio:
 * - /latest (lectura) → cualquier logueado (0)
 * - /update (escritura/side-effects) → Supervisor+ (1)  
 */

// Obtener el ultimo clima registrado en BD
router.get(
  '/latest',
  validate(schema.latestQuery),
  checkRole(0),
  getLatestWeather
);

// Actualizar el clima desde API externa y guardar en BD
// Mejora REST: que sea POST (tiene efectos). 
router.post(
  '/update',
  validate(schema.updateQuery), // valida lat/lon/units/lang si vienen
  checkRole(1),                 // Supervisor+
  fetchWeather
);

module.exports = router;
