### Discord Docs

Spooks you.

##### Latest commit

Up to date as of 298ee7a7abf02ab6dd0944f9493c4dd5b71be31f.

##### Licensing

All data is under the [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) license. This means that if you run any code on it, the license remains the same. The main licensing restriction is that I must be attributed. Data in this case encompasses all JSON files.

All code is under the [Parity license version 7.0.0](https://paritylicense.com/versions/7.0.0). [Compared to what you may be used to](https://github.com/licensezero/parity-public-license#comparing), this license requires any changes to the code to be contributed unless those changes are strictly prototypal (and only in use for less than 30 days). To be clear, "contributed" here essentially means that you simply place the code in a location where I am likely to find it.

Both of these summaries may be wrong: I am not a lawyer and none of what I write adds or removes conditions from these licenses. You can find the full license texts to both attached. (TODO: attach)

##### Modifications to JSON Schema behavior

Unfortunately, `$ref` (`allOf` between two schemas) with differing `required` doesn't do anything. E.g.:

```json
{
    "$ref": "https://docs.helvetica.moe/schemas/integration.json",
    "required": []
}
```

I require this to work for partial objects. Therefore, all generators used against this will need a small little patch. I will write my own as an example.

More generally, I require that properties next to a `$ref` *replace* rather than *merge with* the original properties. I could offer a pre-processor that turns this into valid JSONSchema and I should do so.

The previous "merge with" behavior is still achievable via an explicit `allOf`.

Additionally, my schemas contain a `flags` property that lists the flags for some numbers. I should figure out if I should actually do this: either the flags need to exclude anything which isn't a combination of them or I should drop the concept. I guess alternatively they should be metadata, in which they should allow for descriptions too!
