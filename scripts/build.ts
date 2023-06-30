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
            if (Array.isArray(s)) return s.map((x) => recurse(x));
            else if (typeof s === "object" && s !== null) {
               return Object.fromEntries(
                  Object.entries(s).map(([subkey, value]) => {
                     if (subkey === "$ref") {
                        const refURL = new URL(value, key);
                        return [
                           subkey,
                           `#/$defs${
                              refURL.pathname.slice(
                                 0,
                                 refURL.pathname.length - 5,
                              )
                           }${refURL.hash.slice(1)}`,
                        ];
                     }
                     return [subkey, recurse(value)];
                  }),
               );
            } else return s;
         };

         return [keyURL.pathname, recurse(value)];
      }),
   ),
});
