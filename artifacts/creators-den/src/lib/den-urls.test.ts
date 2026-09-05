import { describe, expect, it } from "vitest";
import { channelProjectUrl, denRouteInfo, projectUrl } from "./den-urls";

describe("denRouteInfo", () => {
  it("classifies the CMS grid root", () => {
    expect(denRouteInfo("/")).toEqual({ mode: "cms" });
    expect(denRouteInfo("")).toEqual({ mode: "cms" });
  });

  it("classifies channel home vs channel-project routes", () => {
    expect(denRouteInfo("/channels/ch_1")).toEqual({ mode: "channel", channelId: "ch_1" });
    expect(denRouteInfo("/channels/ch_1/analytics")).toEqual({ mode: "channel", channelId: "ch_1" });
    expect(denRouteInfo("/channels/ch_1/projects/p_1")).toEqual({
      mode: "channel-project",
      channelId: "ch_1",
      projectId: "p_1",
    });
    expect(denRouteInfo("/channels/ch_1/projects/p_1/role/video")).toEqual({
      mode: "channel-project",
      channelId: "ch_1",
      projectId: "p_1",
    });
  });

  it("classifies legacy flat project links", () => {
    expect(denRouteInfo("/projects/p_1")).toEqual({ mode: "flat-project", projectId: "p_1" });
    expect(denRouteInfo("/projects/p_1/preview")).toEqual({ mode: "flat-project", projectId: "p_1" });
  });

  it("classifies den-level surfaces as other", () => {
    expect(denRouteInfo("/profile")).toEqual({ mode: "other" });
    expect(denRouteInfo("/notifications")).toEqual({ mode: "other" });
    expect(denRouteInfo("/explore")).toEqual({ mode: "other" });
  });

  it("classifies the Arena surfaces as other (no channel/project chrome)", () => {
    expect(denRouteInfo("/arena")).toEqual({ mode: "other" });
    expect(denRouteInfo("/arena/mine")).toEqual({ mode: "other" });
    expect(denRouteInfo("/arena/posts/p_1")).toEqual({ mode: "other" });
  });
});

describe("projectUrl", () => {
  it("builds channel-scoped links when the channel is known", () => {
    expect(projectUrl("ch_1", "p_1")).toBe("/channels/ch_1/projects/p_1");
    expect(projectUrl("ch_1", "p_1", "/review")).toBe("/channels/ch_1/projects/p_1/review");
  });

  it("falls back to the legacy flat path for unlinked projects", () => {
    expect(projectUrl(null, "p_1")).toBe("/projects/p_1");
    expect(projectUrl(undefined, "p_1", "/preview")).toBe("/projects/p_1/preview");
  });

  it("channelProjectUrl always nests under the channel", () => {
    expect(channelProjectUrl("ch_1", "p_1")).toBe("/channels/ch_1/projects/p_1");
    expect(channelProjectUrl("ch_1", "p_1", "/activity")).toBe("/channels/ch_1/projects/p_1/activity");
  });
});