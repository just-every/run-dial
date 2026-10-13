import { assert, hexId, stable } from "../../modules/deploy-kit/validation.mjs";
import { reconcileResources } from "../../modules/deploy-kit/resources.mjs";
import { workerConsumerScript } from "../../modules/deploy-kit/queue-consumer.mjs";
import { durableNamespaces, activeWorker } from "../../modules/deploy-kit/worker.mjs";

/** Exact receipt identities only; never delete account resources by substring. */
export async function teardown({ api, plan, receipt, confirm }) {
  assert(plan.worker.startsWith("rer-seedproof-") && receipt.accountId === api.accountId && receipt.worker === plan.worker, "teardown-disposable-receipt-required");
  const resources = await reconcileResources(api, plan, { create: false });
  const namespaces = await durableNamespaces(api, plan, { requireAll: true });
  assert(stable(resources) === stable(receipt.resources) && stable(namespaces) === stable(receipt.durableObjects), "teardown-resource-identity-drift");
  const worker = await activeWorker(api, plan.worker);
  assert(worker?.versionId === receipt.provider.versionId && worker.etag === receipt.provider.etag, "teardown-worker-identity-drift");
  const requests = [{ path: `/workers/scripts/${plan.worker}?force=true`, method: "DELETE" }, ...resources.queues.map(x => ({ path: `/queues/${x.id}`, method: "DELETE" })), ...resources.r2.map(x => ({ path: `/r2/buckets/${x.name}`, method: "DELETE" })), ...resources.d1.map(x => ({ path: `/d1/database/${x.id}`, method: "DELETE" }))];
  if (!confirm) return { ok: true, scope: "read-only-teardown-plan", prefix: plan.worker, resources, durableObjects: namespaces, requests, deleted: false };
  assert(confirm === plan.worker, "teardown-confirmation-mismatch");
  const consumerLists = await Promise.all(resources.queues.map(queue => api.request(`/queues/${queue.id}/consumers`)));
  const consumerIds = new Set();
  for (const consumers of consumerLists) {
    assert(Array.isArray(consumers) && consumers.every(x => workerConsumerScript(x) === plan.worker), "teardown-foreign-queue-consumer");
    assert(consumers.length <= 1, "teardown-ambiguous-queue-consumer");
    for (const consumer of consumers) {
      assert(typeof consumer.consumer_id === "string" && hexId(consumer.consumer_id) && /^[a-f0-9]{32}$/.test(consumer.consumer_id), "teardown-invalid-consumer-id");
      assert(!consumerIds.has(consumer.consumer_id), "teardown-ambiguous-queue-consumer");
      consumerIds.add(consumer.consumer_id);
    }
  }
  for (const [index, queue] of resources.queues.entries()) {
    for (const consumer of consumerLists[index]) {
      await api.request(`/queues/${queue.id}/consumers/${consumer.consumer_id}`, { method: "DELETE" });
    }
  }
  // R2 refuses deletion of a non-empty bucket. This command never purges objects.
  for (const request of requests) await api.request(request.path, { method: request.method });
  const [databases, buckets, queues, remainingNamespaces] = await Promise.all([
    api.list("/d1/database"), api.list("/r2/buckets", { field: "buckets", pagination: "r2-bounded" }), api.list("/queues"), api.list("/workers/durable_objects/namespaces")
  ]);
  assert(!databases.some(x => resources.d1.some(r => r.id === x.uuid)) && !buckets.some(x => resources.r2.some(r => r.name === x.name)) && !queues.some(x => resources.queues.some(r => r.id === x.queue_id)) && !remainingNamespaces.some(x => namespaces.some(r => r.id === x.id)) && !(await activeWorker(api, plan.worker)), "teardown-incomplete-review-provider-state");
  return { ok: true, scope: "authenticated-scoped-teardown", prefix: plan.worker, deleted: true, remainingOwnedResources: [] };
}

/** Interrupted first deploy: report exact names/IDs for review, without inventing a receipt. */
export async function inventory({ api, plan }) {
  assert(plan.worker.startsWith("rer-seedproof-"), "teardown-disposable-prefix-required");
  const [d1, r2, queues, namespaces] = await Promise.all([
    api.list("/d1/database"), api.list("/r2/buckets", { field: "buckets", pagination: "r2-bounded" }), api.list("/queues"), api.list("/workers/durable_objects/namespaces")
  ]);
  return { ok: true, scope: "read-only-interrupted-deploy-inventory", prefix: plan.worker, accountId: api.accountId,
    worker: await activeWorker(api, plan.worker) ? { name: plan.worker, present: true } : null,
    resources: { d1: d1.filter(x => plan.d1.some(y => y.name === x.name)).map(x => ({ name: x.name, id: x.uuid })), r2: r2.filter(x => plan.r2.some(y => y.name === x.name)).map(x => ({ name: x.name })), queues: queues.filter(x => plan.queues.some(y => y.name === x.queue_name)).map(x => ({ name: x.queue_name, id: x.queue_id })) },
    durableObjects: namespaces.filter(x => x.script === plan.worker).map(x => ({ id: x.id, className: x.class })), deleted: false, requiresIdentityReview: true };
}
