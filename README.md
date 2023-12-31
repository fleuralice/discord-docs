## Discord Docs

Spooks you. 👻

[How scary!!!~](https://docs.helvetica.moe) I thought I was safe!! Maybe if
enough people contribute we can exorcise the ghosts?

There's still a lot to do and ghosts are a moving target, after all. There are a
couple major things left:

- automatically know when documentation is missing
- automatically know when keys are redundent

Additionally, a lot of work has to be done to figure out constraints on fields
and on objects generally (e.g. ADTs).

See also <https://github.com/discord/discord-api-spec>, which contains an
OpenAPI specification for the HTTP API.

nya

##### Latest commit from the documentation

Latest update was
[05acd50cdefbb8e94be68aa9a0fb88b54919f642](https://github.com/discord/discord-api-docs/commit/83e79075d766c3ba3fa75468b983018d5a49967f).
[Here are the changes since then](https://github.com/discord/discord-api-docs/compare/83e79075d766c3ba3fa75468b983018d5a49967f..main).

##### Licensing

All data is under the
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) license. This
means that if you run any code on it, the license remains the same. The main
licensing restriction is that I must be attributed. Data in this case
encompasses all JSON files.

All code is under the
[Parity license version 7.0.0](https://paritylicense.com/versions/7.0.0).
[Compared to what you may be used to](https://github.com/licensezero/parity-public-license#comparing),
this license requires any changes to the code to be contributed unless those
changes are strictly prototypal (and only in use for less than 30 days). To be
clear, "contributed" here essentially means that you simply place the code in a
location where I am likely to find it.

Both of these summaries may be wrong: I am not a lawyer and none of what I write
adds or removes conditions from these licenses. You can find the full license
texts to both attached.

##### Modifications to JSON Schema behavior

Unfortunately, `$ref` (`allOf` between two schemas) with differing `required`
doesn't do anything. E.g.:

```json
{
   "$ref": "/schemas/some-object.json",
   "required": []
}
```

I require this to work for partial objects. Therefore, all generators used
against this will need a small little patch. Or, they can use the
[compatibility bundle](https://docs.helvetica.moe/bundle.compat.json)!

More generally, I require that properties next to a `$ref` _replace_ rather than
_merge with_ the original properties. The previous "merge with" behavior is
still achievable via an explicit `allOf`.

Additionally, my schemas contain a `x-flags` property that lists the flags for
some numbers. If the `type` is `string`, then these `x-flags` will be `string`s
(or more precisely: bigints). Otherwise if the `type` is `integer`, then these
`x-flags` will be `integer`s. I should figure out if I should actually do this:
either the flags need to exclude anything which isn't a combination of them or I
should drop the concept. I guess alternatively they should be metadata, in which
case they should allow for descriptions too!
