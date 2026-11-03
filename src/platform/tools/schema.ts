import { Type, type Schema } from "@google/genai";
import { z } from "zod";

/**
 * Converts a Zod schema to the OpenAPI-subset `Schema` used by Gemini function
 * declarations (works for both generateContent and the Live API). Zod stays the
 * single source of truth: the same schema validates the model's arguments.
 */
type JsonSchema = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  anyOf?: JsonSchema[];
};

const TYPE_MAP: Record<string, Type> = {
  object: Type.OBJECT,
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
};

function convert(s: JsonSchema): Schema {
  if (s.anyOf) {
    const nonNull = s.anyOf.filter((x) => x.type !== "null");
    return { ...convert(nonNull[0] ?? {}), nullable: true, description: s.description };
  }
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  const out: Schema = { type: TYPE_MAP[type ?? "string"] ?? Type.STRING };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum.map(String);
  if (s.minimum !== undefined) out.minimum = s.minimum;
  if (s.maximum !== undefined) out.maximum = s.maximum;
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, convert(v)]));
    if (s.required?.length) out.required = s.required;
  }
  if (s.items) out.items = convert(s.items);
  return out;
}

export function zodToGeminiSchema(schema: z.ZodType): Schema {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
  return convert(json);
}
