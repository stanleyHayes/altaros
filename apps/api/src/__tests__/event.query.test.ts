import { describe, expect, it } from "vitest";
import { eventQuerySchema } from "../interfaces/http/controllers/event.controller.js";
import { eventListFilter } from "../domain/event/adapters/event.mongo.adapter.js";
import eventRouter from "../interfaces/http/routes/event.routes.js";

interface RouterLayer {
  route?: { path?: string; methods?: Record<string, boolean> };
}

describe("event list query", () => {
  it("registers member RSVP history before the dynamic event detail route", () => {
    const getPaths = (eventRouter as unknown as { stack: RouterLayer[] }).stack
      .filter((layer) => layer.route?.methods?.get)
      .map((layer) => layer.route?.path);

    expect(getPaths.indexOf("/rsvps/me")).toBeGreaterThanOrEqual(0);
    expect(getPaths.indexOf("/rsvps/me")).toBeLessThan(getPaths.indexOf("/:id"));
  });

  it("parses an explicit upcoming query without treating false as truthy", () => {
    expect(eventQuerySchema.parse({ upcoming: "true", sortOrder: "asc", limit: "3" }))
      .toEqual({ upcoming: true, sortOrder: "asc", limit: 3 });
    expect(eventQuerySchema.parse({ upcoming: "false" }))
      .toEqual({ upcoming: false });
  });

  it("rejects unbounded or malformed pagination", () => {
    expect(() => eventQuerySchema.parse({ limit: "101" })).toThrow();
    expect(() => eventQuerySchema.parse({ page: "0" })).toThrow();
    expect(() => eventQuerySchema.parse({ upcoming: "yes" })).toThrow();
  });

  it("filters upcoming pagination before counting and slicing", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    expect(eventListFilter("church-1", { upcoming: true }, now)).toEqual({
      churchId: "church-1",
      endDate: { $gte: now },
    });
    expect(eventListFilter("church-1", { upcoming: false }, now))
      .toEqual({ churchId: "church-1" });
  });
});
