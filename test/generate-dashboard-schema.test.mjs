import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { inferSchema } from "../scripts/generate-dashboard.mjs";

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
    if (typeof schema.minItems === "number" && value.length < schema.minItems) fail("too few items");
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) fail("too many items");
    if (schema.items === false && schema.prefixItems && value.length > schema.prefixItems.length) {
      fail("unexpected array item");
    }
    schema.prefixItems?.forEach((childSchema, index) => {
      if (index in value) {
        errors.push(...validateAgainstSchema(childSchema, value[index], `${path}/${index}`));
      }
    });
    return errors;
  }

  if (schema.type === "number" && typeof value !== "number") fail("expected number");
  if (schema.type === "boolean" && typeof value !== "boolean") fail("expected boolean");
  if (schema.type === "string" && typeof value !== "string") fail("expected string");
  return errors;
}

test("dashboard array schema preserves position-specific object fields", async () => {
  const dashboard = await currentDashboard();
  const schema = inferSchema(dashboard);
  const headlineItems = schema.properties.trends.properties.headline.prefixItems;

  assert.equal(headlineItems.length, dashboard.trends.headline.length);
  assert.ok(headlineItems[1].properties.goodWhenUp);
  assert.deepEqual(headlineItems[1].required, ["label", "d90", "d30", "today", "goodWhenUp"]);
});

test("generated schema accepts the current data.json", async () => {
  const dashboard = await currentDashboard();
  const errors = validateAgainstSchema(inferSchema(dashboard), dashboard);

  assert.deepEqual(errors, []);
});

test("generated schema rejects missing position-specific fields", async () => {
  const dashboard = await currentDashboard();
  const candidate = structuredClone(dashboard);
  delete candidate.trends.headline[1].goodWhenUp;
  const errors = validateAgainstSchema(inferSchema(dashboard), candidate);

  assert.ok(errors.some((error) => error.path === "/trends/headline/1"));
});

test("generated schema rejects unexpected keys", async () => {
  const dashboard = await currentDashboard();
  const candidate = structuredClone(dashboard);
  candidate.trends.headline[1].unexpected = true;
  const errors = validateAgainstSchema(inferSchema(dashboard), candidate);

  assert.ok(errors.some((error) => error.message === "unexpected property"));
});
