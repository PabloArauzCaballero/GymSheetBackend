# Postman collection

`collection.json` mirrors the complete hardening route inventory:

- health, readiness, metrics and gateway;
- registration, login and current user;
- anthropometric profile;
- equipment administration;
- personal and global exercises;
- favorites and exercise media;
- external dataset dry run;
- workout sessions, session exercises and sets;
- JSON and CSV exports.

## Variables

Set these collection variables before running protected requests:

```txt
baseUrl
bearerToken
testEmail
testPassword
```

Resource identifiers are collection variables so responses can be copied into later requests:

```txt
equipmentId
exerciseId
workoutId
sessionExerciseId
setId
mediaId
```

Administrative requests require a bearer token belonging to an active database user with role `ADMIN`. A normal client token is expected to receive `403` on those routes.

## Recommended execution order

1. Run `Register` or `Login` and copy `data.accessToken` to `bearerToken`.
2. Create or update the profile.
3. Create an exercise or obtain an existing visible `exerciseId`.
4. Start a workout and copy returned identifiers as each nested resource is created.
5. Exercise ownership failures with a second client account.
6. Run exports and operational endpoints.

The collection intentionally contains no real credentials or tokens. Do not commit populated environment files or exported Postman environments.

## Contract maintenance

Any controller, route, schema, status, limit or error-format change must update all three artifacts in the same pull request:

```txt
docs/endpoints/openapi.yaml
docs/endpoints/endpoints.md
docs/postman/collection.json
```
