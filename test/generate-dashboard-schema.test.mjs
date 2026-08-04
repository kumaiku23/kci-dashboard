import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { inferSchema, normalizeDashboardForSchema } from "../scripts/generate-dashboard.mjs";

async function currentDashboard() {
  return JSON.parse(await readFile(new URL("../data.json", import.meta.url), "utf8"));
}

function validateAgainstSchema(schema, value, path = "") {
  const errors = [];
  const fail = (message) => errors.push({ path, message });

  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("expected object");
      return errors;
    }

    for (const key of schema.required || []) {
      if (!(key in value)) {
        errors.push({ path, message: `missing required property ${key}` });
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!schema.properties || !(key in schema.properties)) {
          errors.push({ path: path ? `${path}/${key}` : `/${key}`, message: "unexpected property" });
        }
      }
    }

    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (key in value) {
        errors.push(...validateAgainstSchema(childSchema, value[key], `${path}/${key}`));
      }
    }
    return errors;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      fail("expected array");
      return errors;
    }
    value.forEach((item, index) => {
      errors.push(...validateAgainstSchema(schema.items, item, `${path}/${index}`));
    });
    return errors;
  }

  if (schema.type === "number" && typeof value !== "number") fail("expected number");
  if (schema.type === "boolean" && typeof value !== "boolean") fail("expected boolean");
  if (schema.type === "string" && typeof value !== "string") fail("expected string");
  return errors;
}

test("every trends.headline row has identical keys", async () => {
  const dashboard = normalizeDashboardForSchema(await currentDashboard());
  const expectedKeys = ["label", "d90", "d30", "today", "goodWhenUp"];

  dashboard.trends.headline.forEach((row) => {
    assert.deepEqual(Object.keys(row), expectedKeys);
  });
});

test("trends.headline goodWhenUp is true only for Opportunity", async () => {
  const dashboard = normalizeDashboardForSchema(await currentDashboard());

  dashboard.trends.headline.forEach((row) => {
    assert.equal(row.goodWhenUp, row.label === "Opportunity");
  });
});

test("generated OpenAI schema uses object items and no prefixItems", async () => {
  const dashboard = normalizeDashboardForSchema(await currentDashboard());
  const schema = inferSchema(dashboard);
  const headlineSchema = schema.properties.trends.properties.headline;

  assert.equal(headlineSchema.type, "array");
  assert.equal(typeof headlineSchema.items, "object");
  assert.equal("prefixItems" in headlineSchema, false);
  assert.ok(headlineSchema.items.properties.goodWhenUp);
  assert.deepEqual(headlineSchema.items.required, ["label", "d90", "d30", "today", "goodWhenUp"]);
});

test("generated schema accepts the current data.json", async () => {
  const dashboard = normalizeDashboardForSchema(await currentDashboard());
  const errors = validateAgainstSchema(inferSchema(dashboard), dashboard);

  assert.deepEqual(errors, []);
});

test("generated schema rejects missing position-specific fields", async () => {
  const dashboard = normalizeDashboardForSchema(await currentDashboard());
  const candidate = structuredClone(dashboard);
  delete candidate.trends.headline[1].goodWhenUp;
  const errors = validateAgainstSchema(inferSchema(dashboard), candidate);

  assert.ok(errors.some((error) => error.path === "/trends/headline/1"));
});

test("generated schema rejects unexpected keys", async () => {
  const dashboard = normalizeDashboardForSchema(await currentDashboard());
  const candidate = structuredClone(dashboard);
  candidate.trends.headline[1].unexpected = true;
  const errors = validateAgainstSchema(inferSchema(dashboard), candidate);

  assert.ok(errors.some((error) => error.message === "unexpected property"));
});
