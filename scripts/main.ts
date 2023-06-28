import { parse } from "https://deno.land/x/swc@0.2.1/mod.ts";
import type {
   Expression,
   ObjectExpression,
   Property,
   VariableDeclaration,
} from "https://esm.sh/@swc/core@1.2.212/types.js";
import { KeyValueProperty } from "https://esm.sh/@swc/core@1.2.212/types.js";

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

      // TODO: if the error function errors, have a sane error
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
         (sum, str) => sum + str.length,
         0,
      );

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

         if (
            contents["$id"] !==
               `https://docs.helvetica.moe/${schemaLocation}${dirEntry.name}`
         ) {
            console.log(
               `error: ${schemaLocation}${dirEntry.name} has incorrect $id`,
            );
            reportError(
               errorMap[errorMap.length - 1]!,
               ["$id"],
               "incorrect $id",
            );
         }
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

if (hadErrors) {
   console.log("errored :(");
   Deno.exit(1);
} else {
   console.log("success!");
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
               await Deno.copyFile(
                  `${schemaLocation}${dirEntry.name}`,
                  `dist/${schemaLocation}${dirEntry.name}`,
               );
            }
         }
      }
   }
}
