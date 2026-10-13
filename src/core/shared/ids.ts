import { ulid } from "ulid";

export function createId() {
  return ulid();
}

export function nowIso() {
  return new Date().toISOString();
}
