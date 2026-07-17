# Training data and interoperability standards review

## Scope

GymSheet is a training-log backend, not a medical device and not a clinical decision-support system. The data model must support useful resistance-training records while avoiding unsupported medical prescriptions or claims.

The review uses the following external references:

- World Health Organization, *Guidelines on physical activity and sedentary behaviour*.
- American College of Sports Medicine position stands on resistance-training prescription and progression.
- HL7 FHIR R5 `Observation` and the body-weight profile for health-data interoperability.
- UCUM-compatible unit semantics for quantities that may later be exchanged with clinical systems.

## Design implications

### 1. Exercise definition

An exercise definition should distinguish stable catalog information from one performance instance.

Required catalog concepts:

```txt
name
category
bodyPart
muscleGroup
targetMuscle
secondaryMuscles
synergistMuscleGroup
requiredEquipment
description
instructions by language
instruction steps by language
media
source and attribution
```

The catalog does not prescribe load, volume, frequency, or suitability for a specific person. Those decisions depend on goals, training status, capacity, health status, and professional evaluation.

### 2. Session and performance data

A workout session records what occurred:

```txt
user
start and end timestamps
status
ordered exercises
set number
repetitions
load in kilograms
repetitions in reserve (RIR)
rest before the set in seconds
notes and emphasis marker
```

The model keeps sets separate rather than storing arrays inside a session row. This supports ordering, constraints, partial updates, auditing, and future analytics.

### 3. Progressive resistance training

ACSM guidance treats progression as dependent on the trainee, objective, experience, and response. The backend therefore stores raw performance variables and does not hard-code a universal progression algorithm.

A future recommendation module would require, at minimum:

```txt
training experience
validated goal
exercise history
recent performance
fatigue and recovery signals
pain or contraindication workflow
explicit algorithm version
explanation and confidence
professional-review rules
```

Such a module must be isolated from the training log, evaluated separately, and prevented from making diagnostic or rehabilitation claims.

### 4. Public-health guidance

WHO recommendations concern population-level frequency, intensity, and duration of physical activity. GymSheet may use those references for educational summaries, but an individual session record must remain factual and should not be labeled automatically as medically sufficient, safe, or appropriate.

### 5. Interoperability mapping

The current internal model can be mapped to health-data standards without making PostgreSQL tables direct FHIR resources.

| GymSheet concept | Interoperability concept | Notes |
|---|---|---|
| `weightKg` | FHIR `Observation.valueQuantity` | Use a quantity with UCUM-compatible `kg` semantics. |
| `heightCm` | FHIR `Observation.valueQuantity` | Use `cm` semantics and an appropriate observation code. |
| measurement timestamp | FHIR `Observation.effective[x]` | Preserve the time the measurement was valid, not only row creation time. |
| user | FHIR `subject` | Requires an explicit identity-mapping and consent policy. |
| source/provenance | FHIR `Provenance`-like semantics | Keep source URL, external ID, version, attribution, import timestamp, and checksum. |

No FHIR endpoint is exposed in this phase. A later interoperability adapter must:

- use a dedicated contract and mapper;
- define coding systems and profiles explicitly;
- preserve units and timestamps;
- apply consent, purpose limitation, access control, and audit requirements;
- avoid exposing internal database identifiers as universal health identifiers.

### 6. Units and numeric integrity

Canonical persistence units currently used:

```txt
body weight: kg
training load: kg
height: cm
rest: seconds
repetitions: integer count
RIR: integer from 0 to 10
```

API consumers must not infer pounds or minutes from numeric values. A future public contract version should represent quantities explicitly as `{ value, unit, system, code }` when cross-system exchange is required.

### 7. Multimedia requirements

Images, GIFs, and video references belong to `training.exercise_media`, not to the exercise row.

Each media record stores:

```txt
media type
provider
URL and optional thumbnail URL
MIME type
dimensions
SHA-256 when available
alternative text
attribution
license
primary flag
sort order
status
source-specific metadata
creator
```

This supports accessibility, integrity checks, content replacement, licensing review, multiple providers, and more than one visual angle per exercise.

### 8. Data provenance and quality

Every imported exercise needs:

```txt
source identifier
source type
source version
source URL
source license
source attribution
import timestamp
content fingerprint
raw-source metadata needed for traceability
```

The importer validates the complete external snapshot before writes. Repeated imports use stable external identity. Custom exercises remain independent and are not overwritten.

## Safety boundaries

The API must not:

- diagnose injuries or conditions;
- prescribe rehabilitation automatically;
- claim that an exercise is safe for every person;
- infer medical readiness from age, weight, or height alone;
- hide the origin or license of imported instructional media;
- convert public-health guidance into individualized medical advice without a validated clinical workflow.

## Source references

- WHO: https://www.who.int/publications/i/item/9789240015128
- ACSM 2026 resistance-training position stand: https://pubmed.ncbi.nlm.nih.gov/41843416/
- ACSM progression position stand: https://pubmed.ncbi.nlm.nih.gov/19204579/
- HL7 FHIR R5 Observation: https://www.hl7.org/fhir/observation.html
- HL7 FHIR body-weight example: https://hl7.org/fhir/R5/observation-example.html
