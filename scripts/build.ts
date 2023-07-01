type SchemaMapping = Record<string, Record<string, unknown>>;

export const createSchemaMapping = (
   schemas: Record<string, unknown>[],
): SchemaMapping =>
   Object.fromEntries(
      schemas.filter((s) => typeof s["$id"] === "string").map((
         s,
      ) => [s["$id"] as string, s]),
   );

export const bundle = (schemas: SchemaMapping): Record<string, unknown> => ({
   "$id": "https://docs.helvetica.moe/bundled.json",
   "$schema": "https://json-schema.org/draft/2020-12/schema",
   "$comment":
      'All-in-one bundle for JSON Schemas. Add a `"$ref": "#/$defs/<schema location>"` and now you have a completely local schema!',
   "$defs": Object.fromEntries(
      Object.entries(schemas).map(([key, value]) => {
         const keyURL = new URL(key);
         const recurse = (s: unknown): unknown => {
            if (Array.isArray(s)) {
               return s.map((x) => recurse(x));
            } else if (typeof s === "object" && s !== null) {
               return Object.fromEntries(
                  Object.entries(s).map(([subkey, value]) => {
                     if (subkey === "$ref") {
                        const refURL = new URL(value, key);
                        return [
                           subkey,
                           `#/$defs/${
                              refURL.pathname.slice(
                                 refURL.pathname.lastIndexOf("/") + 1,
                                 refURL.pathname.length - 5,
                              )
                           }${refURL.hash.slice(1)}`,
                        ];
                     }
                     return [subkey, recurse(value)];
                  }),
               );
            } else {
               return s;
            }
         };

         // TODO: lint to confirm that these minor names are unique
         return [
            keyURL.pathname.slice(
               keyURL.pathname.lastIndexOf("/") + 1,
               keyURL.pathname.length - 5,
            ),
            recurse(value),
         ];
      }),
   ),
});

export const partialCompatibility = (schema: Record<string, unknown>) => ({
   "$id": "https://docs.helvetica.moe/bundled.compat.json",
   "$schema": "https://json-schema.org/draft/2020-12/schema",
   "$comment": "Compatibility schema with $ref extension inlined.",
   "$defs": Object.fromEntries(
      Object.entries(schema["$defs"]!).map(([key, value]) => {
         const recurse = (
            s: unknown,
            currentPath: (string | number)[],
         ): unknown => {
            if (Array.isArray(s)) {
               return s.map((x, j) => recurse(x, [...currentPath, j]));
            } else if (typeof s === "object" && s !== null) {
               if ("$ref" in s && Object.entries(s).length > 1) {
                  const path = (s["$ref"] as string).split("/").slice(1).map((
                     piece,
                  ) =>
                     Number.isInteger(parseFloat(piece))
                        ? parseInt(piece)
                        : piece
                  );

                  if (
                     path.reduce((b, c, i) => b && c === currentPath[i], true)
                  ) {
                     // recursive $ref, see comment in main.ts...
                     return Object.fromEntries(
                        Object.entries(s).map((
                           [key, value],
                        ) => [key, recurse(value, [...currentPath, key])]),
                     );
                  }

                  const otherSchema = path.reduce(
                     (s, p) => s[p] as Record<string, undefined>,
                     schema,
                  );

                  return {
                     ...recurse(otherSchema, path) as Record<string, unknown>,
                     ...Object.fromEntries(
                        Object.entries(s).filter(([key, _]) => key !== "$ref")
                           .map((
                              [key, value],
                           ) => [key, recurse(value, [...currentPath, key])]),
                     ),
                  };
               }

               return Object.fromEntries(
                  Object.entries(s).map((
                     [key, value],
                  ) => [key, recurse(value, [...currentPath, key])]),
               );
            } else {
               return s;
            }
         };

         return [key, recurse(value, ["$defs", key])];
      }),
   ),
});
