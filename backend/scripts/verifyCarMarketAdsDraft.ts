import { rotationError } from '../src/services/metaAdsRotationGraph.js';
import { createSharedBudgetRotationPlan } from '../src/services/metaAdsRotationPlan.js';
import { runSharedBudgetCycle } from '../src/services/metaAdsRotationRunner.js';
import { getCarMarketRotationConnection, rotationJournal } from '../src/services/metaAdsRotationRuntime.js';
import { selectNextRotationPosts } from '../src/services/metaAdsRotationSelection.js';

try {
  const runId = process.argv[2];
  if (!runId || !/^[a-z0-9-]{1,32}$/.test(runId)) throw new Error('Supply a unique lowercase draft reference.');
  const { ownerId, connection } = await getCarMarketRotationConnection();
  const pair = selectNextRotationPosts(connection);
  const plan = createSharedBudgetRotationPlan({
    ...pair, dailyBudgetCents: 100, startTime: new Date(Date.now() + 10 * 60_000),
  });
  const journal = rotationJournal(ownerId, pair, -1, true);
  const result = await runSharedBudgetCycle({
    cycleKey: `carmarket_ads_rotation_draft_${runId}`,
    plan,
    meta: connection.clientFor(pair),
    journal: {
      ...journal,
      async save(key, event) {
        console.info(event.stage, event.platform ?? '', event.id ?? '');
        await journal.save(key, event);
      },
    },
    draft: true,
  });
  console.info(result);
} catch (error) {
  console.error(rotationError(error));
  process.exitCode = 1;
}
