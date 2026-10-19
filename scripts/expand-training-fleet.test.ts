import { expect, test } from "bun:test";
import { fleetRoles } from "./fleet-config";
import { planExpansion } from "./expand-training-fleet";

test("adds exactly nine per routine, with unique valid handles, and rerunning adds none", () => {
  const existing = fleetRoles.map((role, index) => ({
    name: "Original" + index,
    role,
  }));
  const additions = planExpansion(existing);
  expect(additions).toHaveLength(90);
  const all = [...existing, ...additions];
  for (const role of fleetRoles)
    expect(all.filter((bot) => bot.role === role)).toHaveLength(10);
  expect(new Set(all.map((bot) => bot.name.toLowerCase())).size).toBe(100);
  expect(additions.every((bot) => /^[a-zA-Z0-9]{1,12}$/.test(bot.name))).toBe(
    true,
  );
  expect(planExpansion(all)).toEqual([]);
});
test("avoids reserved account names case-insensitively and never removes excess accounts", () => {
  const existing = fleetRoles.map((role, index) => ({
    name: "Original" + index,
    role,
  }));
  const first = planExpansion(existing);
  const additions = planExpansion(existing, [
    ...first.map((bot) => bot.name.toUpperCase()),
  ]);
  expect(additions).toHaveLength(90);
  expect(
    additions.every(
      (bot) =>
        !first.some((a) => a.name.toLowerCase() === bot.name.toLowerCase()),
    ),
  ).toBe(true);
  expect(() => planExpansion([...existing, ...first], [], 9)).toThrow(
    "exceeds",
  );
});
