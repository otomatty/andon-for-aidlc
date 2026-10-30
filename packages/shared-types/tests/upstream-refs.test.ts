import { describe, expect, it } from "vitest";
import {
  UPSTREAM_GIT_URL,
  UPSTREAM_REPO_SLUG,
  UPSTREAM_REPO_URL,
  upstreamBlobUrl,
} from "../src/index.ts";

describe("upstream repository coordinates", () => {
  it("addresses the repository without naming a branch", () => {
    expect(UPSTREAM_REPO_SLUG).toBe("awslabs/aidlc-workflows");
    expect(UPSTREAM_REPO_URL).toBe("https://github.com/awslabs/aidlc-workflows");
    expect(UPSTREAM_GIT_URL).toBe("https://github.com/awslabs/aidlc-workflows.git");
  });

  // The default branch moved v2 -> main at GA and v2 was deleted; a link that
  // names a branch is one rename away from 404ing for every reader.
  it("links through HEAD so a default-branch rename cannot break the link", () => {
    expect(upstreamBlobUrl("docs/guide/01-getting-started.md")).toBe(
      "https://github.com/awslabs/aidlc-workflows/blob/HEAD/docs/guide/01-getting-started.md",
    );
    expect(upstreamBlobUrl("/CHANGELOG.md")).toBe(
      "https://github.com/awslabs/aidlc-workflows/blob/HEAD/CHANGELOG.md",
    );
    expect(upstreamBlobUrl("CHANGELOG.md")).not.toContain("/blob/v2/");
    expect(upstreamBlobUrl("CHANGELOG.md")).not.toContain("/blob/main/");
  });
});
