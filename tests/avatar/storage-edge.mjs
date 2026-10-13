let failDelete = false;
let failPut = false;
let gate;

export async function storageControl(path, body) {
  if (path === '/__fixture/fail-delete') failDelete = Boolean(body.enabled);
  else if (path === '/__fixture/put') {
    failPut = body.fail ?? false;
    gate = body.pause ? { phase: body.pause, entered: Promise.withResolvers(), released: Promise.withResolvers(), used: false } : undefined;
  } else if (path === '/__fixture/put-paused') {
    if (!gate) throw Error('No controlled PUT');
    return Response.json({ key: await gate.entered.promise });
  } else if (path === '/__fixture/release-put') gate?.released.resolve();
  else return;
  return Response.json({ ok: true });
}

// Only the R2 network edge is controlled; every successful operation reaches
// native R2. Barriers expose real interleavings, without elapsed-time authority.
export function storageEdge(bucket) {
  return new Proxy(bucket, { get(target, property) {
    if (property === 'delete') return async key => {
      if (failDelete) throw Error('Synthetic R2 delete outage');
      return target.delete(key);
    };
    if (property === 'put') return async (...args) => {
      const selected = gate && !gate.used ? gate : undefined;
      if (selected) selected.used = true;
      const pause = async phase => {
        if (selected?.phase === phase) { selected.entered.resolve(args[0]); await selected.released.promise; }
      };
      if (failPut === 'before') throw Error('Synthetic R2 PUT failure before storage');
      await pause('before');
      const object = await target.put(...args);
      await pause('after');
      if (failPut === 'after') throw Error('Synthetic R2 PUT failure after storage');
      return object;
    };
    const value = target[property];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
