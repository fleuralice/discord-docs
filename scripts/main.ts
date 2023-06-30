import { parse } from "https://deno.land/x/swc@0.2.1/mod.ts";
import type {
   Expression,
   ObjectExpression,
   Property,
   VariableDeclaration,
} from "https://esm.sh/@swc/core@1.2.212/types.js";
import { KeyValueProperty } from "https://esm.sh/@swc/core@1.2.212/types.js";
import { bundle, createSchemaMapping } from "./build.ts";

const dryRun = !Deno.args.includes("--build");

if (dryRun) {
   console.log("running a dry run!");
} else {
   console.log("building...");
}

// make sure to update deno.json's watch configuration if updating this list
const schemaLocations = ["schemas/"];
const schemas: Record<string, unknown>[] = [];
const errorMap: [ObjectExpression, string, string][] = [];
let hadErrors = false;

const reportError = (
   error: typeof errorMap[0],
   path: (string | number)[],
   message: string,
) => {
   let structure: Expression = error[0];
   const startByte = structure.span.start;

   while (path.length) {
      const index = path[0];
      path = path.slice(1);

      if (typeof index === "string" && structure.type === "ObjectExpression") {
         // most of the type checks are literally just constrained by JSON
         const result = structure.properties.filter((prop) =>
            prop.type === "KeyValueProperty" &&
            prop.key.type === "StringLiteral" && prop.key.value === index
         )[0] as Property | undefined;
         if (!result) throw new Error("error function passed invalid path");
         structure = (result as KeyValueProperty).value;
      } else if (
         typeof index === "number" && structure.type === "ArrayExpression"
      ) {
         const result: Expression | undefined = structure.elements[index]
            ?.expression;
         if (!result) throw new Error("error function passed invalid path");
         structure = result;
      } else {
         throw new Error("error function passed invalid path");
      }
   }

   // bunch of impossible types for JSON
   if (
      structure.type === "MetaProperty" ||
      structure.type === "JSXMemberExpression" ||
      structure.type === "JSXNamespacedName"
   ) throw new Error("impossible");

   const errorStart = structure.span.start - startByte;
   const line = (error[2].slice(0, errorStart + 1).match(/\n/g)?.length || 0) +
      1;
   const char = errorStart -
      error[2].split("\n").slice(0, line - 1).reduce(
         (sum, str) => sum + str.length + 1,
         0,
      ) + 1;

   console.error(`${error[1]}:${line}:${char}: ${message}`);
   hadErrors = true;
};

for (const schemaLocation of schemaLocations) {
   for await (const dirEntry of Deno.readDir(schemaLocation)) {
      if (dirEntry.isFile && dirEntry.name.endsWith(".json")) {
         const textContent = await Deno.readTextFile(
            `${schemaLocation}${dirEntry.name}`,
         );
         const contents = JSON.parse(
            textContent,
         );

         errorMap.push(
            [
               (await parse("const x = " + textContent, {
                  syntax: "ecmascript",
               }).body[0] as VariableDeclaration).declarations[0]!
                  .init as ObjectExpression,
               `${schemaLocation}${dirEntry.name}`,
               textContent,
            ],
         );

         // LINT: check that every schema has a matching `$id`
         if (
            contents["$id"] !==
               `https://docs.helvetica.moe/${schemaLocation}${dirEntry.name}`
         ) {
            reportError(
               errorMap[errorMap.length - 1]!,
               ["$id"],
               "incorrect $id",
            );
         }

         // LINT: check that every schema is using JSONSchema 2020-12
         if (
            contents["$schema"] !==
               "https://json-schema.org/draft/2020-12/schema"
         ) {
            reportError(
               errorMap[errorMap.length - 1]!,
               ["$schema"],
               "incorrect $schema",
            );
         }

         schemas.push(contents);
      }
   }
}

// LINT: check that all `$ref`s point to valid `$id` (TODO: JSON Path checking)
const ids: unknown[] = schemas.map((schema) => schema["$id"]);
if (ids.filter((id) => typeof id === "string").length === ids.length) {
   schemas.forEach((schema, i) => {
      const recurse = (s: unknown, path: (string | number)[]) => {
         if (Array.isArray(s)) s.forEach((x, j) => recurse(x, [...path, j]));
         else if (typeof s === "object" && s !== null) {
            Object.entries(s).forEach(([key, value]) => {
               if (key === "$ref") {
                  try {
                     const url = new URL(value, schema["$id"] as string);
                     url.hash = "";
                     if (!ids.includes(url.toString())) {
                        reportError(
                           errorMap[i]!,
                           [...path, "$ref"],
                           "unknown $ref",
                        );
                     }
                  } catch {
                     reportError(
                        errorMap[i]!,
                        [...path, "$ref"],
                        "invalid $ref",
                     );
                  }
               }
               recurse(value, [...path, key]);
            });
         }
      };

      recurse(schema, []);
   });
}

// LINT: check that there are no `{"type": "object"}` (with no other keys)
schemas.forEach((schema, i) => {
   const recurse = (s: unknown, path: (string | number)[]) => {
      if (Array.isArray(s)) s.forEach((x, j) => recurse(x, [...path, j]));
      else if (typeof s === "object" && s !== null) {
         if (
            "type" in s && s["type"] === "object" && Object.keys(s).length === 1
         ) {
            reportError(
               errorMap[i]!,
               path,
               'bare {"type": "object"}',
            );
         }

         Object.entries(s).forEach(([key, value]) => {
            recurse(value, [...path, key]);
         });
      }
   };

   recurse(schema, []);
});

// LINT: check that the only key adjacent to a `$ref` is `required`
schemas.forEach((schema, i) => {
   const recurse = (s: unknown, path: (string | number)[]) => {
      if (Array.isArray(s)) s.forEach((x, j) => recurse(x, [...path, j]));
      else if (typeof s === "object" && s !== null) {
         if (
            "$ref" in s &&
            Object.keys(s).filter((k) => !["$ref", "required"].includes(k))
               .length
         ) {
            reportError(
               errorMap[i]!,
               path,
               "weird key adjacent to a $ref",
            );
         }

         Object.entries(s).forEach(([key, value]) => {
            recurse(value, [...path, key]);
         });
      }
   };

   recurse(schema, []);
});

// LINT: check that every $ref is a relative link
schemas.forEach((schema, i) => {
   const recurse = (s: unknown, path: (string | number)[]) => {
      if (Array.isArray(s)) s.forEach((x, j) => recurse(x, [...path, j]));
      else if (typeof s === "object" && s !== null) {
         Object.entries(s).forEach(([key, value]) => {
            if (key === "$ref") {
               try {
                  // relative URL means that without a base, it will error
                  const url = new URL(value);
                  url.hash = "";
                  reportError(
                     errorMap[i]!,
                     [...path, "$ref"],
                     "absolute $ref",
                  );
               } catch {
                  // this is the case I want
               }
            }
            recurse(value, [...path, key]);
         });
      }
   };

   recurse(schema, []);
});

if (hadErrors) {
   console.log("errored :(");
   if (!Deno.args.includes("--dev")) Deno.exit(1);
} else {
   console.log("success!");

   const schemaMapping = createSchemaMapping(schemas);
   const bundled = bundle(schemaMapping);

   if (!dryRun) {
      try {
         await Deno.remove("dist/", { recursive: true });
      } catch {
         // clearing dist directory. if it doesn't exist, this will error but I don't care
      }

      await Deno.mkdir("dist/");

      for (const schemaLocation of schemaLocations) {
         await Deno.mkdir(`dist/${schemaLocation}`);
         for await (const dirEntry of Deno.readDir(schemaLocation)) {
            if (dirEntry.isFile && dirEntry.name.endsWith(".json")) {
               await Deno.writeTextFile(
                  `dist/${schemaLocation}${dirEntry.name}`,
                  JSON.stringify(
                     JSON.parse(
                        await Deno.readTextFile(
                           `${schemaLocation}${dirEntry.name}`,
                        ),
                     ),
                  ),
               );
            }
         }
      }

      await Deno.writeTextFile("dist/bundled.json", JSON.stringify(bundled));
   }
}
