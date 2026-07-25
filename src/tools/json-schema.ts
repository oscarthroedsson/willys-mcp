import type { z } from "zod";

/**
 * Convert a Zod schema to the JSON Schema advertised to the client.
 *
 * This has to be RECURSIVE and type-accurate, not just top-level. A previous
 * version flattened everything to string/number/boolean, so `ingredients`
 * (an array of objects) was advertised as a bare string. The MCP client then
 * coerced the argument to a string before it ever reached the server, and Zod
 * rejected it with "expected array, received string" — plan_add_recipe, and
 * every tool with an array or enum field, was unusable through the protocol.
 *
 * Value constraints (regex, min/max) are deliberately omitted: they are
 * enforced by Zod at call time. The advertised schema only needs the shape.
 */
interface Unwrapped {
  inner: z.ZodTypeAny;
  optional: boolean;
  description?: string;
}

/** Peel default/optional/nullable/effects wrappers, collecting description. */
function unwrap(schema: z.ZodTypeAny): Unwrapped {
  let cur = schema;
  let optional = false;
  let description: string | undefined;

  for (let i = 0; i < 8; i++) {
    const d = cur._def as {
      typeName?: string;
      innerType?: z.ZodTypeAny;
      schema?: z.ZodTypeAny;
      description?: string;
    };
    description ??= d.description;

    if (d.typeName === "ZodDefault" || d.typeName === "ZodOptional") {
      optional = true;
      cur = d.innerType!;
    } else if (d.typeName === "ZodNullable") {
      cur = d.innerType!;
    } else if (d.typeName === "ZodEffects") {
      cur = d.schema!; // .refine()/.transform() wrapper
    } else {
      break;
    }
  }

  return description === undefined
    ? { inner: cur, optional }
    : { inner: cur, optional, description };
}

function toJsonNode(schema: z.ZodTypeAny): Record<string, unknown> {
  const { inner, description } = unwrap(schema);
  const d = inner._def as {
    typeName?: string;
    type?: z.ZodTypeAny;
    values?: unknown[];
    value?: unknown;
    shape?: () => Record<string, z.ZodTypeAny>;
  };

  let node: Record<string, unknown>;
  switch (d.typeName) {
    case "ZodObject": {
      const shape = d.shape!();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shape)) {
        properties[key] = toJsonNode(field);
        if (!unwrap(field).optional) required.push(key);
      }
      node = { type: "object", properties };
      if (required.length > 0) node.required = required;
      break;
    }
    case "ZodArray":
      node = { type: "array", items: toJsonNode(d.type!) };
      break;
    case "ZodNumber":
      node = { type: "number" };
      break;
    case "ZodBoolean":
      node = { type: "boolean" };
      break;
    case "ZodEnum":
      node = { type: "string", enum: d.values };
      break;
    case "ZodLiteral":
      node =
        typeof d.value === "boolean"
          ? { type: "boolean", enum: [d.value] }
          : { const: d.value };
      break;
    default:
      node = { type: "string" };
  }

  if (description !== undefined) node.description = description;
  return node;
}

/** JSON Schema advertised to the client, derived from the same Zod source. */
export function jsonSchema(shape: z.ZodTypeAny): Record<string, unknown> {
  const node = toJsonNode(shape);
  // The manifest's inputSchema is always an object at the top level.
  return node.type === "object" ? node : { type: "object", properties: {} };
}
