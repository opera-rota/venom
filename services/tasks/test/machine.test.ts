import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stepMoves, taskMoves } from "../src/index.ts";

const migration = readFileSync(join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations", "0006_tasks.sql"), "utf8");

function databaseMoves(functionName: string): string[] {
  const body = migration.slice(migration.indexOf(`create function ${functionName}`));
  const list = body.slice(body.indexOf("array[") + 6, body.indexOf("]"));
  return [...list.matchAll(/'([a-z_]+>[a-z_]+)'/g)].map((match) => match[1] ?? "").sort();
}

function codeMoves(table: Readonly<Record<string, readonly string[]>>): string[] {
  return Object.entries(table)
    .flatMap(([from, targets]) => targets.map((to) => `${from}>${to}`))
    .sort();
}

describe("the state machine in code matches the one the database enforces", () => {
  it("allows the same step moves", () => {
    expect(codeMoves(stepMoves)).toEqual(databaseMoves("steps_moves_allowed"));
  });

  it("allows the same task moves", () => {
    expect(codeMoves(taskMoves)).toEqual(databaseMoves("tasks_moves_allowed"));
  });

  it("never lets finished work change", () => {
    expect(stepMoves.done).toEqual([]);
    expect(taskMoves.completed).toEqual([]);
  });
});
