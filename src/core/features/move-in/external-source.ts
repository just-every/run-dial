import type { Resource, SourceData } from './source';

export type SourceLoss={resource:Resource;sourceId:string;field:string;reason:string};
export type ExternalSource={data:SourceData;losses:SourceLoss[];capturedAt:string};
