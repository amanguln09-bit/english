import { describe, it, expect } from "vitest";
import { games, Game, score } from "../lib/content";
import {
  createSession,
  join,
  command,
  submit,
  view,
  refresh,
  participant,
} from "../server/engine";
import { validateCurriculum } from "../scripts/curriculum";
import curriculum from "../data/curriculum.json";
describe("content & provenance", () => {
  it("validates every sample and answer key", () => {
    for (const g of games) {
      expect(Game.safeParse(g).success).toBe(true);
      for (const q of g.questions)
        if (q.kind !== "discussion") expect(score(q, q.answer)).toBe(true);
    }
  });
  it("keeps unknown curriculum unverified", () => {
    expect(validateCurriculum(curriculum).objectives).toHaveLength(0);
  });
  it("rejects duplicate and dangling objectives", () => {
    const source = {
      id: "s",
      url: "https://example.org",
      title: "Source",
      status: "verified",
    };
    const o = {
      code: "6.1.1.1",
      sourceId: "s",
      grade: 6,
      skill: "test",
      officialText: "Test fixture, not official",
      verified: true,
    };
    expect(() =>
      validateCurriculum({
        ...curriculum,
        sources: [source],
        objectives: [o, o],
      }),
    ).toThrow("Duplicate");
    expect(() =>
      validateCurriculum({
        ...curriculum,
        mappings: [
          {
            topicId: "missing",
            objectiveCode: "6.1.1.1",
            status: "unverified",
            rationale: "Test",
          },
        ],
      }),
    ).toThrow("Dangling");
  });
  it("discussion is not incorrect", () =>
    expect(score(games[1].questions[2], ["My idea"])).toBeNull());
});
describe("authoritative session engine", () => {
  function setup() {
    const s = createSession(games[0], "teacher", 180, "teacher", 1000);
    const p = join(s, "Learner", 1001);
    return { s, p };
  }
  it("joins 30 distinct participants and enforces capacity", () => {
    const { s } = setup();
    for (let i = 0; i < 29; i++) join(s, "P" + i, 1002);
    expect(s.participants).toHaveLength(30);
    expect(new Set(s.participants.map((p) => p.tokenHash)).size).toBe(30);
    s.capacity = 30;
    expect(() => join(s, "extra", 1002)).toThrow("full");
  });
  it("rejects unauthorized commands and tokens", () => {
    const { s } = setup();
    expect(() => command(s, "stranger", "start", 1002)).toThrow("Forbidden");
    expect(() => participant(s, "bad", 1002)).toThrow("Unauthorized");
  });
  it("scores once and hides answer keys", () => {
    const { s, p } = setup();
    command(s, "teacher", "start", 1002);
    expect(
      view(s, "student", p.participantId, 1003).question,
    ).not.toHaveProperty("answer");
    submit(s, p.token, 0, ["library"], 1003);
    expect(s.participants[0].score).toBe(100);
    expect(() => submit(s, p.token, 0, ["library"], 1004)).toThrow("Already");
    expect(view(s, "student", p.participantId, 1004).own).toBeNull();
    command(s, "teacher", "reveal", 1004);
    expect(view(s, "student", p.participantId, 1004).question?.answer).toEqual([
      "library",
    ]);
  });
  it("preserves pause time and rejects late/stale answers", () => {
    const { s, p } = setup();
    command(s, "teacher", "start", 1002);
    command(s, "teacher", "pause", 2002);
    expect(s.remaining).toBe(179000);
    expect(() => submit(s, p.token, 0, ["library"], 2003)).toThrow(
      "not accepting",
    );
    command(s, "teacher", "resume", 10002);
    expect(s.deadline).toBe(189002);
    command(s, "teacher", "next", 10003);
    expect(() => submit(s, p.token, 0, ["library"], 10004)).toThrow();
    refresh(s, 189003);
    expect(s.state).toBe("FINISHED");
  });
  it("survives serialization and resumes participant identity", () => {
    const { s, p } = setup();
    const restored = JSON.parse(JSON.stringify(s));
    expect(participant(restored, p.token, 1003).id).toBe(p.participantId);
  });
  it("expires PIN and participant tokens", () => {
    const { s, p } = setup();
    refresh(s, s.expires + 1);
    expect(s.state).toBe("EXPIRED");
    expect(() => join(s, "new", s.expires + 1)).toThrow("closed");
    expect(() => participant(s, p.token, s.expires + 1)).toThrow();
  });
  it("does not accept answers once revealed", () => {
    const { s, p } = setup();
    command(s, "teacher", "start", 1002);
    command(s, "teacher", "reveal", 1003);
    expect(() => submit(s, p.token, 0, ["library"], 1004)).toThrow();
  });
  it("keeps participant names off the public board", () => {
    const { s } = setup();
    command(s, "teacher", "finish", 1003);
    expect(JSON.stringify(view(s, "display", undefined, 1004))).not.toContain(
      "Learner",
    );
  });
});

describe("all five complete game runs", () => {
  for (const g of games)
    it(g.title + " accepts all answer types and finishes", () => {
      const s = createSession(g, "teacher", 180, "immediate", 1000);
      const p = join(s, "Test player", 1001);
      command(s, "teacher", "start", 1002);
      for (let i = 0; i < g.questions.length; i++) {
        const q = g.questions[i];
        submit(
          s,
          p.token,
          i,
          q.kind === "discussion" ? ["My own explanation"] : q.answer,
          1003 + i * 2,
        );
        command(s, "teacher", "next", 1004 + i * 2);
      }
      expect(s.state).toBe("FINISHED");
      expect(s.participants[0].score).toBe(
        g.questions.filter((q) => q.kind !== "discussion").length * 100,
      );
      expect(createSession(g, "teacher", 180, "teacher", 2000).id).not.toBe(
        s.id,
      );
    });
});
