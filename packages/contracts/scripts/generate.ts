import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { contracts, engines, prompts } from "../src/index.ts";

const packageRoot = join(import.meta.dirname, "..");
const repoRoot = join(packageRoot, "..", "..");
const schemaFile = join(packageRoot, "generated", "venom.schema.json");
const pythonPackage = join(packageRoot, "python", "venom_contracts");
const modelsFile = join(pythonPackage, "models.py");
const promptsFile = join(pythonPackage, "prompts.json");
const enginesFile = join(pythonPackage, "engines.json");

function buildSchema(): object {
  const { schemas } = z.toJSONSchema(contracts, {
    target: "draft-2020-12",
    uri: (id) => `#/$defs/${id}`,
    override: ({ zodSchema, jsonSchema }) => {
      if (jsonSchema.format !== undefined) {
        delete jsonSchema.pattern;
      }
      if (zodSchema instanceof z.ZodDiscriminatedUnion) {
        jsonSchema["discriminator"] = { propertyName: zodSchema._zod.def.discriminator };
      }
    },
  });

  const definitions = Object.entries(schemas)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, { $schema: _schema, $id: _id, ...definition }]) => [id, definition] as const);

  const objectShapes = definitions
    .filter(([, definition]) => definition.type === "object")
    .map(([id]) => ({ $ref: `#/$defs/${id}` }));

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:venom:contracts",
    title: "Contract",
    anyOf: objectShapes,
    $defs: Object.fromEntries(definitions),
  };
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function generatePythonModels(): void {
  execFileSync(
    "uv",
    [
      "run",
      "--frozen",
      "datamodel-codegen",
      "--input", schemaFile,
      "--input-file-type", "jsonschema",
      "--output", modelsFile,
      "--output-model-type", "pydantic_v2.BaseModel",
      "--target-python-version", "3.14",
      "--output-datetime-class", "AwareDatetime",
      "--enum-field-as-literal", "all",
      "--use-annotated",
      "--use-standard-collections",
      "--use-union-operator",
      "--field-constraints",
      "--use-type-alias",
      "--use-double-quotes",
      "--disable-timestamp",
      "--formatters", "builtin",
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
}

writeJson(schemaFile, buildSchema());
writeJson(promptsFile, prompts);
writeJson(enginesFile, engines);
generatePythonModels();

for (const file of [schemaFile, promptsFile, enginesFile, modelsFile]) {
  console.log(`generated ${relative(repoRoot, file)}`);
}
