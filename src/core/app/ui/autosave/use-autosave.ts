import { useEffect, useState, useSyncExternalStore } from "react";
import { carriedFor, guard, useLeaveGuard, type Carried } from "./leave-guard";

/** Text saves this long after the last key, or at once when its field is left. */
const typingPause = 600;

type Values = Record<string, unknown>;
/** Sends the form's whole current object to its endpoint, and throws when the save did not land. */
export type Write<T> = (next: T, init: RequestInit) => Promise<void>;
/**
 * One field's save: just saved, failed (its value stays in the field, with the server's reason when it answered one; none
 * when the request never arrived), or asking first (its confirm is open).
 */
export type FieldState = { saved: boolean; failed: boolean; reason?: string; asking: boolean };
type Snapshot<T> = { values: T; saved: T; justSaved: ReadonlySet<keyof T>; failed: ReadonlySet<keyof T>; reason?: string; asking: ReadonlySet<keyof T> };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const without = <K>(set: ReadonlySet<K>, ...items: K[]) => new Set([...set].filter((item) => !items.includes(item)));
/** Forms with something unsaved outlive their screen, so a form shown again (or a page that goes) still has its values. */
const forms = new Map<string, unknown>();

class Form<T extends Values> {
  mounted = 0;
  private snapshot: Snapshot<T>;
  private readonly listeners = new Set<() => void>();
  private readonly confirmed = new Set<keyof T>();
  private timer?: ReturnType<typeof setTimeout>;
  private busy = false;
  private again = false;
  private result = Promise.resolve(true);
  private release?: () => void;

  constructor(readonly key: string, initial: T, private write: Write<T>, private readonly asks: ReadonlySet<keyof T>) {
    this.snapshot = { values: initial, saved: initial, justSaved: new Set(), failed: new Set(), asking: new Set() };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  read = () => this.snapshot;

  /** The latest render's write: a form held past its screen keeps the last one it was given. */
  connect(write: Write<T>) {
    this.write = write;
  }

  /** A text field's value: it saves once typing pauses. */
  type = <K extends keyof T>(field: K, value: T[K]) => {
    this.set(field, value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.settle(), typingPause);
  };

  /** A switch or a choice: it saves at once. */
  choose = <K extends keyof T>(field: K, value: T[K]) => {
    this.set(field, value);
    void this.settle();
  };

  /** Leaving a field saves at once what its typing left waiting. */
  leave = () => {
    if (this.timer !== undefined) void this.settle();
  };

  /** The confirm's action: the field's new value saves. */
  confirm = (field: keyof T) => {
    this.confirmed.add(field);
    this.update({ asking: without(this.snapshot.asking, field) });
    void this.save();
  };

  /** The confirm's other way: the field goes back to its saved value. */
  keep = (field: keyof T) => this.set(field, this.snapshot.saved[field]);

  retry = () => void this.save();

  /** Leaving: everything the form holds saves first. True once nothing is left unsaved. */
  async flush() {
    await this.settle();
    return !this.unsaved().length;
  }

  /**
   * The page is going: what can be sent goes now, with keepalive, past any request in flight (the page drops that one). It
   * is also handed back with its saved values, to travel to the tab's next page.
   */
  sendOnHide(): Carried | undefined {
    if (!this.unsaved().some((field) => !this.waiting(field))) return undefined;
    const values = this.payload();
    void this.write(values, { keepalive: true }).catch(() => undefined);
    return { values, base: this.snapshot.saved };
  }

  /** Shown again: fields with nothing unsaved take the fresh values, and unsaved ones keep what was typed. */
  refresh(initial: T) {
    const values = { ...initial }, saved = { ...initial };
    for (const field of this.unsaved()) {
      values[field] = this.snapshot.values[field];
      saved[field] = this.snapshot.saved[field];
    }
    this.snapshot = { ...this.snapshot, values, saved };
  }

  /** On screen. Taken off, it saves what it holds and stays held until that lands. */
  attach() {
    this.mounted++;
    forms.set(this.key, this);
    this.release ??= guard(this);
    const carried = carriedFor(this.key);
    if (carried) this.resume(carried);
    // Shown again with values a save left unsaved (it failed, or is still on its way): they go again at once.
    else if (this.unsaved().some((field) => !this.waiting(field))) void this.settle();
    return () => {
      this.mounted--;
      void this.settle();
      this.retire();
    };
  }

  /**
   * Values the tab's last page left unsaved: a field takes its carried value only while the server and this page still
   * hold the value it replaced, so newer data is never overwritten; then it saves.
   */
  private resume({ values, base }: Carried) {
    const fields = (Object.keys(this.snapshot.values) as Array<keyof T>).filter((field) => !same(values[field as string], base[field as string]) && same(this.snapshot.saved[field], base[field as string]) && same(this.snapshot.values[field], base[field as string]));
    if (!fields.length) return;
    this.update({ values: { ...this.snapshot.values, ...Object.fromEntries(fields.map((field) => [field, values[field as string]])) } });
    void this.settle();
  }

  private update(change: Partial<Snapshot<T>>) {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }

  private set<K extends keyof T>(field: K, value: T[K]) {
    this.confirmed.delete(field);
    // Typed back to its saved value, a field has nothing left to save, ask or retry.
    const back = same(value, this.snapshot.saved[field]);
    const { justSaved, asking, failed } = this.snapshot;
    this.update({ values: { ...this.snapshot.values, [field]: value }, justSaved: without(justSaved, field), asking: back ? without(asking, field) : asking, failed: back ? without(failed, field) : failed });
  }

  private unsaved() {
    const { values, saved } = this.snapshot;
    return (Object.keys(values) as Array<keyof T>).filter((field) => !same(values[field], saved[field]));
  }

  /** A field that asks first holds its change until its confirm's action. */
  private waiting(field: keyof T) {
    return this.asks.has(field) && !this.confirmed.has(field);
  }

  /** The whole current object, with each field still waiting for its confirm at its saved value. */
  private payload() {
    const next = { ...this.snapshot.values };
    for (const field of this.unsaved()) if (this.waiting(field)) next[field] = this.snapshot.saved[field];
    return next;
  }

  /** Typing paused, a field was left or a choice made: changed fields that ask first open their confirm, the rest save. */
  private settle() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const asking = new Set(this.unsaved().filter((field) => this.waiting(field)));
    if (!same([...asking], [...this.snapshot.asking])) this.update({ asking });
    return this.save();
  }

  /** One request in flight: a save asked for meanwhile runs after it, with the newest values. */
  private save() {
    this.again = true;
    if (!this.busy) {
      this.busy = true;
      this.result = this.drain();
    }
    return this.result;
  }

  private async drain() {
    let landed = true;
    while (this.again) {
      this.again = false;
      const fields = this.unsaved().filter((field) => !this.waiting(field));
      if (!fields.length) continue;
      const next = this.payload();
      try {
        await this.write(next, {});
        for (const field of fields) this.confirmed.delete(field);
        this.update({ saved: next, justSaved: new Set(fields), failed: without(this.snapshot.failed, ...fields) });
        landed = true;
      } catch (error) {
        // fetch rejects with a TypeError when the request never arrived; a refusal carries the server's own message.
        this.update({ failed: new Set([...this.snapshot.failed, ...fields]), reason: error instanceof Error && !(error instanceof TypeError) ? error.message : undefined });
        landed = false;
      }
    }
    this.busy = false;
    this.retire();
    return landed;
  }

  /** Off screen with nothing left to save: it leaves the store, and a form shown again starts from fresh values. */
  private retire() {
    if (this.mounted || this.busy || this.unsaved().length) return;
    if (forms.get(this.key) === this) forms.delete(this.key);
    this.release?.();
    this.release = undefined;
  }
}

function formFor<T extends Values>(key: string, initial: T, write: Write<T>, asks: ReadonlyArray<keyof T>) {
  // The server renders each request on its own: nothing is shared between them.
  if (typeof window === "undefined") return new Form(key, initial, write, new Set(asks));
  const held = forms.get(key) as Form<T> | undefined;
  if (held) {
    held.refresh(initial);
    return held;
  }
  const form = new Form(key, initial, write, new Set(asks));
  forms.set(key, form);
  return form;
}

/**
 * One form that saves as it changes (DL2). `key` names the record and endpoint (one key per form), `initial` is its saved
 * object, and `write` sends the whole current object. Text calls `type` on each change and `leave` on blur; switches and
 * choices call `choose`. Fields named in `asks` hold their change until `confirm` (or go back with `keep`); while one waits,
 * saves carry its saved value. Each form keeps one request in flight with the newest values queued behind it, and saving
 * changes nothing but this form's own state, so a page never remounts, scrolls or closes a menu (U9).
 */
export function useAutosave<T extends Values>(key: string, initial: T, write: Write<T>, { asks = [] }: { asks?: ReadonlyArray<keyof T> } = {}) {
  const [form] = useState(() => formFor(key, initial, write, asks));
  useLeaveGuard();
  useEffect(() => form.attach(), [form]);
  useEffect(() => form.connect(write));
  const { values, saved, justSaved, failed, reason, asking } = useSyncExternalStore(form.subscribe, form.read, form.read);
  const state = (field: keyof T): FieldState => {
    const unsaved = !same(values[field], saved[field]);
    return { saved: justSaved.has(field) && !unsaved, failed: failed.has(field) && unsaved, reason: failed.has(field) && unsaved ? reason : undefined, asking: asking.has(field) };
  };
  return { values, state, type: form.type, choose: form.choose, leave: form.leave, confirm: form.confirm, keep: form.keep, retry: form.retry };
}
