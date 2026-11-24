/**
 * MARS's licence PUBLIC key (Ed25519, SPKI/DER, base64). The matching private key stays with MARS (admin portal /
 * scripts/licence.ts) and is never in this repository.
 *
 * DEVELOPMENT KEY: its private half is in scripts/.keys (git-ignored). Before go-live make a production pair with
 * `npm run licence -- keygen`, keep the private key safe, and replace this value.
 */
export const LICENCE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAzZRtKzdvRSqZ7y1Htcd2V2mxld5rFTIl5lpwFMBVwWI='
