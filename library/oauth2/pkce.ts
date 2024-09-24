import { createHash } from "node:crypto";

export function verifyPkceCodeAgainstCodeChallenge(verifier: string, challenge: string): boolean {
	const challengeFromVerifier = createHash("sha256").update(verifier).digest("base64url");

	return challengeFromVerifier === challenge;
}
