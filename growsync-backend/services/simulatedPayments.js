// Explicit opt-in for isolated development/test only. Production always fails closed.
function enabled(env = process.env) {
  return env.ALLOW_SIMULATED_PAYMENTS === 'true' &&
    ['development', 'test'].includes(env.NODE_ENV);
}

function requireSimulation(req, res, next) {
  if (!enabled()) {
    return res.status(403).json({
      error: 'SimulatedPaymentsDisabled',
      message: 'Los pagos simulados no están habilitados.',
    });
  }
  return next();
}

module.exports = { enabled, requireSimulation };
