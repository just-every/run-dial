import { contract } from './contract.mjs';
import { documentationJourney } from './agent-door/core-journey.mjs';
import { buildDocumentationWorker } from './agent-door/documentation-journey.mjs';

contract('BASE-AGENT-013', 'production agent documentation matches the current MCP inventory without effects', async () => {
  await buildDocumentationWorker();
  await documentationJourney();
});
