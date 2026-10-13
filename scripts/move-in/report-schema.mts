// Writes schemas/move-in-report.schema.json from the report's zod schema (run after changing report-schema.ts):
//   node --experimental-strip-types scripts/move-in/report-schema.mts
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { reportSchema } from '../../src/core/features/move-in/report-schema.ts';
writeFileSync(new URL('../../schemas/move-in-report.schema.json', import.meta.url), JSON.stringify(z.toJSONSchema(reportSchema, { target: 'draft-7' }), null, 2) + '\n');
