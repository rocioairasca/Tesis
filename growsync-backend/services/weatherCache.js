const WEATHER_TTL_MS = 15 * 60 * 1000;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

class WeatherRateLimitedError extends Error {
  constructor(retryAfterSeconds) {
    super('El servicio meteorológico alcanzó temporalmente su límite de consultas.');
    this.code = 'WeatherRateLimited';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function weatherCacheKey(latitude, longitude) {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new RangeError('Invalid weather coordinates');
  }
  // Normalize negative zero too. Coordinates sent to the provider are untouched.
  const rounded = value => Number(value.toFixed(3)).toFixed(3);
  return rounded(latitude) + ':' + rounded(longitude);
}

function retryAfterMs(value, now) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const delay = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  return Number.isFinite(delay) && delay > 0
    ? Math.min(MAX_RETRY_AFTER_MS, Math.max(1000, delay)) : WEATHER_TTL_MS;
}

// One instance per backend process. Lazy expiration + LRU bound, without timers.
// load must return only public weather fields, never user/company data.
function createWeatherCache({ now = Date.now, logger = console, maxEntries = MAX_CACHE_ENTRIES } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('Invalid cache size');
  const entries = new Map();
  const inFlightRequests = new Map();
  let cooldownUntil = 0;

  async function getOrLoad(latitude, longitude, load) {
    const key = weatherCacheKey(latitude, longitude);
    const time = now();
    for (const [storedKey, entry] of entries) {
      if (entry.expiresAt <= time) entries.delete(storedKey);
    }
    const cached = entries.get(key);
    if (cached) {
      entries.delete(key); entries.set(key, cached);
      logger.debug?.('Weather cache hit');
      return { ...cached.value, cache: true };
    }
    // Valid cached readings remain usable during a provider cooldown.
    if (cooldownUntil > time) {
      throw new WeatherRateLimitedError(Math.ceil((cooldownUntil - time) / 1000));
    }
    const pending = inFlightRequests.get(key);
    if (pending) {
      logger.debug?.('Weather request joined in-flight');
      return { ...await pending, cache: true };
    }
    logger.debug?.('Weather cache miss');
    const request = Promise.resolve().then(load).then(value => {
      entries.set(key, { value, expiresAt: now() + WEATHER_TTL_MS });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return value;
    }).catch(error => {
      if (error.response?.status === 429) {
        const headers = error.response.headers;
        const retryAfter = headers?.get?.('retry-after') ?? headers?.['retry-after'] ?? headers?.['Retry-After'];
        cooldownUntil = Math.max(cooldownUntil, now() + retryAfterMs(retryAfter, now()));
        const retryAfterSeconds = Math.ceil((cooldownUntil - now()) / 1000);
        logger.warn?.('Open-Meteo rate limited', { retry_after_seconds: retryAfterSeconds });
        throw new WeatherRateLimitedError(retryAfterSeconds);
      }
      throw error;
    }).finally(() => {
      inFlightRequests.delete(key);
    });
    inFlightRequests.set(key, request);
    return { ...await request, cache: false };
  }

  return { getOrLoad };
}

const weatherCache = createWeatherCache();
module.exports = { weatherCache, createWeatherCache, weatherCacheKey, WEATHER_TTL_MS, MAX_RETRY_AFTER_MS };
