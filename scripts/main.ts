import { parse } from "https://deno.land/x/swc@0.2.1/mod.ts";
import type {
   Expression,
   ObjectExpression,
   Property,
   VariableDeclaration,
} from "https://esm.sh/@swc/core@1.2.212/types.js";
import { KeyValueProperty } from "https://esm.sh/@swc/core@1.2.212/types.js";
import { bundle, createSchemaMapping, partialCompatibility } from "./build.ts";

const dryRun = !Deno.args.includes("--build");

if (dryRun) {
   console.log("running a dry run!");
} else {
   console.log("building...");
}

// make sure to update deno.json's watch configuration if updating this list
const schemaLocations = ["schemas/", "events/"];
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
         if (!result) {
            throw new Error(`error function passed invalid path: ${path}`);
         }
         structure = (result as KeyValueProperty).value;
      } else if (
         typeof index === "number" && structure.type === "ArrayExpression"
      ) {
         const result: Expression | undefined = structure.elements[index]
            ?.expression;
         if (!result) {
            throw new Error(`error function passed invalid path: ${path}`);
         }
         structure = result;
      } else {
         throw new Error(`error function passed invalid path: ${path}`);
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
            "type" in s && ["object", "array"].includes(s.type as string) &&
            Object.keys(s).filter((k) =>
                  !["type", "$id", "$schema"].includes(k)
               ).length === 0
         ) {
            reportError(
               errorMap[i]!,
               path,
               `bare {"type": "${s["type"]}"}`,
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

// LINT: check that `$ref`s point to valid places
const schemaMapping = createSchemaMapping(schemas);
schemas.forEach((schema, i) => {
   const recurse = (s: unknown, path: (string | number)[]) => {
      if (Array.isArray(s)) s.forEach((x, j) => recurse(x, [...path, j]));
      else if (typeof s === "object" && s !== null) {
         Object.entries(s).forEach(([key, value]) => {
            if (key === "$ref") {
               const [id, refPath] =
                  (new URL(value, schema["$id"] as string).toString()).split(
                     "#",
                  );
               const otherSchema = schemaMapping[id!]!;
               if (refPath) {
                  const jsonPath = (refPath as string).split(
                     "/",
                  ).slice(1).map((
                     piece,
                  ) =>
                     Number.isInteger(parseFloat(piece))
                        ? parseInt(piece)
                        : piece
                  );

                  const referenced = jsonPath.reduce(
                     (s, p) =>
                        Array.isArray(s) && typeof p === "number"
                           ? s[p]
                           : typeof s === "object" && s !== null && p in s
                           ? (s as Record<string, unknown>)[p]
                           : undefined,
                     otherSchema as unknown,
                  );

                  if (
                     typeof referenced !== "object" ||
                     Array.isArray(referenced) || referenced === null
                  ) {
                     reportError(
                        errorMap[i]!,
                        [...path, "$ref"],
                        "incorrect $ref",
                     );
                  }
               }
            }
            recurse(value, [...path, key]);
         });
      }
   };

   recurse(schema, []);
});

// LINT: check all "minor names" used in the bundle are unique
if (
   new Set(schemas.map((schema) => {
      if (typeof schema["$id"] !== "string") return Math.random();
      const keyURL = new URL(schema["$id"]);
      return keyURL.pathname.slice(
         keyURL.pathname.lastIndexOf("/") + 1,
         keyURL.pathname.length - 5,
      );
   })).size !== schemas.length
) {
   console.error("minor names are not unique");
   hadErrors = true;
}

if (hadErrors) {
   console.log("errored :(");
   if (!Deno.args.includes("--dev")) Deno.exit(1);
} else {
   const bundled = bundle(schemaMapping);
   const compat = partialCompatibility(bundled);

   {
      // LINT: ensure that $ref extending doesn't happen in the compat bundle

      // this also will catch recursive $ref extending, e.g.:
      // {
      //    "type": "object",
      //    "properties": {
      //       "x": {
      //          "type": "integer"
      //       },
      //       "y": {
      //          "$ref": "#/",
      //          "required": ["x"]
      //       }
      //    },
      //    "required": ["x", "y"]
      // }
      //
      // this should turn into the following, but that isn't implemented yet
      // {
      //    "type": "object",
      //    "properties": {
      //       "x": {
      //          "type": "integer"
      //       },
      //       "y": {
      //          "type": "object",
      //          "properties": {
      //             "x": {
      //                "type": "integer"
      //             },
      //             "y": {
      //                "$ref": "#/properties/y"
      //             }
      //          },
      //          "required": ["x"]
      //       }
      //    },
      //    "required": ["x", "y"]
      // }
      let errored = false;
      const recurse = (s: unknown) => {
         if (Array.isArray(s)) s.forEach((x) => recurse(x));
         else if (typeof s === "object" && s !== null) {
            if ("$ref" in s && Object.entries(s).length > 1 && !errored) {
               console.error("compat bundle has $ref extending");
               errored = true;
               hadErrors = true;
            }
            Object.values(s).forEach((value) => {
               recurse(value);
            });
         }
      };

      recurse(compat);
   }

   if (hadErrors) {
      console.log("build errors :(");
      if (!Deno.args.includes("--dev")) Deno.exit(1);
   } else {
      console.log("success!");
   }

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
      await Deno.writeTextFile(
         "dist/bundled.compat.json",
         JSON.stringify(compat),
      );
   }
}
