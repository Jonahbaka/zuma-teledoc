# HL7 FHIR R4 JSON schema test fixture

`fhir-r4.schema.json.gz` contains the unmodified `fhir.schema.json` from
https://hl7.org/fhir/R4/fhir.schema.json.zip (FHIR 4.0.1), compressed with gzip
to keep the repository fixture small. Downloaded 2026-10-18.

Uncompressed SHA-256: `2230406893b4cf002a4ee1e5e2bbeca22ac5d2d4931b3e9ef7b9594bbc376a01`.
Official ZIP SHA-256: `75e5560da3cf503895a44c8ca7af17a83b4cca6c2cb5ba1883d2aec0d1cb5ac6`.

FHIR licensing and attribution: https://hl7.org/fhir/R4/license.html.

These tests verify base JSON structure. The schema is not a terminology server
or a full FHIR invariant/profile validator. Passing it does not certify a
partner implementation guide, SMART authorization or external API compatibility.
