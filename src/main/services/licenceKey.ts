/**
 * MARS's licence PUBLIC key (Ed25519, SPKI/DER, base64). The matching private key stays with MARS (admin portal /
 * scripts/licence.ts) and is never in this repository.
 *
 * DEVELOPMENT KEY: its private half is in scripts/.keys (git-ignored). Before go-live make a production pair with
 * `npm run licence -- keygen`, keep the private key safe, and replace this value.
 */
const DEV_KEY = 'MCowBQYDK2VwAyEAzZRtKzdvRSqZ7y1Htcd2V2mxld5rFTIl5lpwFMBVwWI='
/** The MARS admin portal's signing key (the mars-admin-portal project, licence-private.pem). */
const PORTAL_KEY = 'MCowBQYDK2VwAyEAhG/oSyZISwmIgfm6wUF2Sa/JMJopGJSoLrxpyJevNis='

/** Every key a licence may be signed with. Before go-live keep only the production key. */
export const LICENCE_PUBLIC_KEYS: readonly string[] = [PORTAL_KEY, DEV_KEY]
