// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require('../db/supabaseClient');

// ───────────────────────────────────────────────────────────────────────────────
// Helpers: rango temporal (simple, basado en UTC)
// ───────────────────────────────────────────────────────────────────────────────
function computeRange({ from, to, range }) {
  if (from && to) return { from, to };

  const now = new Date();
  const end = new Date(now);
  let start;

  switch ((range || '').toLowerCase()) {
    case 'today': {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
    case 'yesterday': {
      const y = new Date(now); y.setUTCDate(y.getUTCDate() - 1);
      start = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate(), 0, 0, 0));
      end = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate(), 23, 59, 59, 999));
      break;
    }
    case 'last7': {
      start = new Date(now); start.setUTCDate(start.getUTCDate() - 6);
      start.setUTCHours(0, 0, 0, 0);
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
    case 'last30': {
      start = new Date(now); start.setUTCDate(start.getUTCDate() - 29);
      start.setUTCHours(0, 0, 0, 0);
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
    case 'mtd': { // month-to-date
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
    case 'qtd': { // quarter-to-date
      const qStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
      start = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth, 1, 0, 0, 0));
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
    case 'ytd': { // year-to-date
      start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0));
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
    default: {
      // por defecto: last30
      start = new Date(now); start.setUTCDate(start.getUTCDate() - 29);
      start.setUTCHours(0, 0, 0, 0);
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
  }

  return { from: start.toISOString(), to: end.toISOString() };
}

// Aplica filtros comunes de planning a una query Supabase
function applyPlanningFilters(q, { from, to, includeDisabled, includeCanceled }) {
  if (!includeDisabled) q = q.eq('enabled', true);
  if (!includeCanceled) q = q.neq('status', 'cancelado');
  if (from && to) {
    // solapamiento basico: start_at <= to AND end_at >= from
    q = q.lte('start_at', to).gte('end_at', from);
  }
  return q;
}

// ───────────────────────────────────────────────────────────────────────────────
// Controller
// ───────────────────────────────────────────────────────────────────────────────
const getStats = async (req, res) => {
  try {
    // Query params
    const {
      from, to, range,
      includeDisabled = 'false',
      includeCanceled = 'false',
    } = req.query;

    const { company_id } = req.user;
    if (!company_id) return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });

    const { from: F, to: T } = computeRange({ from, to, range });
    const incDisabled = includeDisabled === '1' || String(includeDisabled).toLowerCase() === 'true';
    const incCanceled = includeCanceled === '1' || String(includeCanceled).toLowerCase() === 'true';

    // ── Conteos base  ─────────────────────────────────────────────────────────
    const usersP = supabase.from('users')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company_id);

    const productsP = supabase.from('products')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company_id)
      .eq('enabled', true);

    const lotsP = supabase.from('lots')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company_id)
      .eq('enabled', true);

    const usagesP = supabase.from('usage_records')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company_id)
      .eq('enabled', true);

    // ── Planning KPIs ─────────────────────────────────────────────────────────
    // total (aplicando includeDisabled/includeCanceled y rango)
    let planningTotalQ = supabase.from('planning').select('id', { count: 'exact', head: true }).eq('company_id', company_id);
    planningTotalQ = applyPlanningFilters(planningTotalQ, { from: F, to: T, includeDisabled: incDisabled, includeCanceled: incCanceled });

    // completadas
    let planningCompletedQ = supabase.from('planning').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('status', 'completado');
    planningCompletedQ = applyPlanningFilters(planningCompletedQ, { from: F, to: T, includeDisabled: incDisabled, includeCanceled: true }); // incluir canceladas no afecta

    // canceladas (siempre contamos explicitamente)
    let planningCanceledQ = supabase.from('planning').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('status', 'cancelado');
    planningCanceledQ = applyPlanningFilters(planningCanceledQ, { from: F, to: T, includeDisabled: incDisabled, includeCanceled: true });

    // en demora: status NOT IN (completado,cancelado) AND now() > end_at
    let planningDelayedQ = supabase.from('planning')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company_id)
      .not('status', 'in', '(completado,cancelado)')
      .lt('end_at', new Date().toISOString());
    planningDelayedQ = applyPlanningFilters(planningDelayedQ, { from: F, to: T, includeDisabled: incDisabled, includeCanceled: true });

    // activas: status IN (planificado, pendiente, en_progreso)
    let planningActiveQ = supabase.from('planning')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company_id)
      .in('status', ['planificado', 'pendiente', 'en_progreso']);
    planningActiveQ = applyPlanningFilters(planningActiveQ, { from: F, to: T, includeDisabled: incDisabled, includeCanceled: true });

    // Ejecutar todo en paralelo
    const [
      users, products, lots, usages,
      pTotal, pCompleted, pCanceled, pDelayed, pActive
    ] = await Promise.all([
      usersP, productsP, lotsP, usagesP,
      planningTotalQ, planningCompletedQ, planningCanceledQ, planningDelayedQ, planningActiveQ
    ]);

    // Manejo de errores (alguno fallo)
    const errs = [users, products, lots, usages, pTotal, pCompleted, pCanceled, pDelayed, pActive]
      .map(r => r.error)
      .filter(Boolean);

    if (errs.length) {
      console.error('Error al obtener estadísticas:', errs);
      return res.status(500).json({ message: 'Error al obtener estadísticas' });
    }

    // Respuesta
    return res.json({
      meta: { from: F, to: T, includeDisabled: incDisabled, includeCanceled: incCanceled },
      kpis: {
        users: users.count || 0,
        products: products.count || 0,
        lots: lots.count || 0,
        usages: usages.count || 0,
        planning: {
          total: pTotal.count || 0,
          completed: pCompleted.count || 0,
          canceled: pCanceled.count || 0,
          delayed: pDelayed.count || 0,
          active: pActive.count || 0,
        }
      }
    });

  } catch (error) {
    console.error('Error inesperado al obtener estadísticas:', error);
    return res.status(500).json({ message: 'Error al obtener estadísticas', error: error.message });
  }
};

// EXPORTAMOS LAS FUNCIONES
module.exports = { getStats };
