import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.resolve('eslint'));
const Ajv=require('ajv');
const validate=new Ajv({allErrors:true}).compile(JSON.parse(readFileSync(new URL('../../schemas/move-in-report.schema.json',import.meta.url),'utf8')));
export function assertReport(report){assert.ok(validate(report),JSON.stringify(validate.errors));assert.equal(report.bookingCounts.read,Object.entries(report.bookingCounts).filter(([key])=>key!=='read').reduce((n,[,value])=>n+value,0));for(const count of Object.values(report.counts))assert.equal(count.read,count.imported+count.changed+count.skipped+count.rejected);}
