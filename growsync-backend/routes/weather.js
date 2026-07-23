const router = require('express').Router();
const { fetchWeather, getLatestWeather } = require('../controllers/openWeatherMap');

const validate  = require('../middleware/validate');
const checkRole = require('../middleware/checkRole');
const schema    = require('../validations/weather.schema');

/**
 * Roles:
 *  0 = Empleado (logueado)
 *  1 = Supervisor
 *  2 = Dueno
 *  3 = Admin
 *
 * Criterio:
 * - /latest (lectura) -> cualquier logueado (0)
 * - /update (escritura/side-effects) -> cualquier logueado (0)
 */

// Obtener el ultimo clima registrado en BD
router.get(
  '/latest',
  validate(schema.latestQuery),
  checkRole(0),
  getLatestWeather
);

// Actualizar el clima desde Open-Meteo y guardar en BD
router.post(
  '/update',
  validate(schema.updateQuery),
  checkRole(0),
  fetchWeather
);

module.exports = router;
