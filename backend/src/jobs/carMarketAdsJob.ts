import { rotationError } from '../services/metaAdsRotationGraph.js';
import { runCarMarketRotation } from '../services/metaAdsRotationRuntime.js';

const startDate = process.env.CARMARKET_ADS_ROTATION_START_DATE;
if (startDate) {
  let running = false;
  let lastResult = '';
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runCarMarketRotation(startDate);
      if (result !== lastResult) console.info('[carmarket-ads]', result);
      lastResult = result;
    } catch (error) {
      const reason = rotationError(error);
      if (reason !== lastResult) console.warn('[carmarket-ads]', reason);
      lastResult = reason;
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), 3 * 60_000).unref();
}
