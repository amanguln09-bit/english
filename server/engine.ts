import { randomBytes, randomInt, createHash } from "node:crypto";
import { GameData, score } from "../lib/content";
export type State =
  | "CREATED"
  | "LOBBY"
  | "ACTIVE"
  | "PAUSED"
  | "FINISHED"
  | "EXPIRED"
  | "CANCELLED";
export type Participant = {
  id: string;
  name: string;
  tokenHash: string;
  score: number;
  expires: number;
};
export type Answer = {
  participantId: string;
  question: number;
  value: string[];
  correct: boolean | null;
  points: number;
};
export type Session = {
  id: string;
  pin: string;
  owner: string;
  game: GameData;
  state: State;
  created: number;
  expires: number;
  duration: number;
  remaining: number;
  deadline: number;
  index: number;
  revealed: boolean;
  feedback: "immediate" | "teacher";
  participants: Participant[];
  answers: Answer[];
  capacity: number;
};
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function createSession(
  game: GameData,
  owner: string,
  duration = 180,
  feedback: Session["feedback"] = "teacher",
  now = Date.now(),
): Session {
  return {
    id: randomBytes(18).toString("base64url"),
    pin: String(randomInt(100000, 1000000)),
    owner,
    game: structuredClone(game),
    state: "LOBBY",
    created: now,
    expires: now + 4 * 3600000,
    duration,
    remaining: duration * 1000,
    deadline: 0,
    index: 0,
    revealed: false,
    feedback,
    participants: [],
    answers: [],
    capacity: 40,
  };
}
export function refresh(s: Session, now = Date.now()) {
  if (now >= s.expires && !["FINISHED", "CANCELLED"].includes(s.state))
    s.state = "EXPIRED";
  if (s.state === "ACTIVE" && now >= s.deadline) {
    s.state = "FINISHED";
    s.remaining = 0;
    s.revealed = true;
  }
  return s;
}
export function join(s: Session, name: string, now = Date.now()) {
  refresh(s, now);
  if (!["LOBBY", "ACTIVE", "PAUSED"].includes(s.state))
    throw Error("Session is closed");
  if (s.participants.length >= s.capacity) throw Error("Session is full");
  const token = randomBytes(32).toString("base64url");
  const p = {
    id: randomBytes(12).toString("base64url"),
    name,
    tokenHash: hash(token),
    score: 0,
    expires: s.expires,
  };
  s.participants.push(p);
  return { token, participantId: p.id };
}
export function command(
  s: Session,
  owner: string,
  action: string,
  now = Date.now(),
) {
  refresh(s, now);
  if (s.owner !== owner) throw Error("Forbidden");
  if (action === "start" && s.state === "LOBBY") {
    s.state = "ACTIVE";
    s.deadline = now + s.remaining;
  } else if (action === "pause" && s.state === "ACTIVE") {
    s.remaining = Math.max(0, s.deadline - now);
    s.state = "PAUSED";
  } else if (action === "resume" && s.state === "PAUSED") {
    s.deadline = now + s.remaining;
    s.state = "ACTIVE";
  } else if (action === "reveal" && ["ACTIVE", "PAUSED"].includes(s.state))
    s.revealed = true;
  else if (action === "next" && ["ACTIVE", "PAUSED"].includes(s.state)) {
    if (s.index + 1 < s.game.questions.length) {
      s.index++;
      s.revealed = false;
    } else {
      s.state = "FINISHED";
      s.revealed = true;
    }
  } else if (
    action === "finish" &&
    ["ACTIVE", "PAUSED", "LOBBY"].includes(s.state)
  ) {
    s.state = "FINISHED";
    s.revealed = true;
  } else if (
    action === "cancel" &&
    !["FINISHED", "EXPIRED", "CANCELLED"].includes(s.state)
  )
    s.state = "CANCELLED";
  else throw Error("Invalid state transition");
}
export function participant(s: Session, token: string, now = Date.now()) {
  const p = s.participants.find(
    (p) => p.tokenHash === hash(token) && p.expires > now,
  );
  if (!p) throw Error("Unauthorized participant");
  return p;
}
export function submit(
  s: Session,
  token: string,
  index: number,
  value: string[],
  now = Date.now(),
) {
  refresh(s, now);
  const p = participant(s, token, now);
  if (s.state !== "ACTIVE" || s.revealed || index !== s.index)
    throw Error("Question is not accepting answers");
  if (s.answers.some((a) => a.question === index && a.participantId === p.id))
    throw Error("Already submitted");
  const correct = score(s.game.questions[index], value);
  const points = correct ? 100 : 0;
  p.score += points;
  const a = { participantId: p.id, question: index, value, correct, points };
  s.answers.push(a);
  return a;
}
export function view(
  s: Session,
  role: "host" | "display" | "student",
  pid?: string,
  now = Date.now(),
) {
  refresh(s, now);
  const q = s.game.questions[s.index];
  const reveal = s.revealed || s.state === "FINISHED";
  const own = s.answers.find(
    (a) => a.participantId === pid && a.question === s.index,
  );
  return {
    id: s.id,
    pin: s.pin,
    title: s.game.title,
    template: s.game.template,
    state: s.state,
    index: s.index,
    total: s.game.questions.length,
    remaining:
      s.state === "ACTIVE" ? Math.max(0, s.deadline - now) : s.remaining,
    serverNow: now,
    deadline: s.deadline,
    revealed: reveal,
    feedback: s.feedback,
    count: s.participants.length,
    question: ["ACTIVE", "PAUSED", "FINISHED"].includes(s.state)
      ? {
          id: q.id,
          kind: q.kind,
          prompt: q.prompt,
          options: q.options,
          image: q.image,
          ...(reveal ? { answer: q.answer, explanation: q.explanation } : {}),
        }
      : null,
    participants:
      role === "host"
        ? s.participants.map((p) => ({
            id: p.id,
            name: p.name,
            score: reveal ? p.score : undefined,
          }))
        : [],
    leaderboard:
      s.state === "FINISHED"
        ? (role === "host"
            ? s.participants.map((p) => ({
                id: p.id,
                name: p.name,
                score: p.score,
              }))
            : s.participants.map((p, i) => ({
                id: p.id,
                name: `Player ${i + 1}`,
                score: p.score,
              }))
          ).sort((a, b) => b.score - a.score)
        : [],
    submitted: !!own,
    own:
      own && (reveal || s.feedback === "immediate")
        ? { correct: own.correct, points: own.points }
        : null,
    answered:
      role === "host"
        ? s.answers.filter((a) => a.question === s.index).length
        : undefined,
  };
}
