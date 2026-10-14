import { describe, expect, it } from "vitest";
import { authHeader, credentialsFromEnv, oauthSignature, pct } from "./x-client";

describe("OAuth 1.0a", () => {
  it("matches X's documented signature example", () => {
    // developer.x.com "Creating a signature" worked example.
    const sig = oauthSignature(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json",
      {
        include_entities: "true",
        status: "Hello Ladies + Gentlemen, a signed OAuth request!",
        oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
        oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: "1318622958",
        oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        oauth_version: "1.0",
      },
      "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    );
    expect(sig).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  });

  it("percent-encodes like RFC 3986 and builds the header", () => {
    expect(pct("Ladies + Gentlemen!*")).toBe("Ladies%20%2B%20Gentlemen%21%2A");
    const h = authHeader("POST", "https://api.x.com/2/tweets", { apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "ts" }, {}, "n", "1");
    expect(h).toMatch(/^OAuth oauth_consumer_key="k", oauth_nonce="n", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1", oauth_token="t", oauth_version="1.0", oauth_signature="[^"]+"$/);
  });

  it("needs all four credentials", () => {
    expect(credentialsFromEnv({ X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c" })).toBeNull();
    expect(credentialsFromEnv({ X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_SECRET: "d" })).toEqual({ apiKey: "a", apiSecret: "b", accessToken: "c", accessSecret: "d" });
  });
});
