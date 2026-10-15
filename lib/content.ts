import { z } from "zod";
export const Question = z
  .object({
    id: z.string(),
    kind: z.enum(["single", "multiple", "text", "ordering", "discussion"]),
    prompt: z.string().min(3),
    options: z.array(z.string()).default([]),
    answer: z.array(z.string()),
    explanation: z.string(),
    image: z
      .string()
      .regex(/^\/(?!\/)[A-Za-z0-9_./-]+$/)
      .optional(),
  })
  .superRefine((q, c) => {
    if (
      new Set(q.options).size !== q.options.length ||
      new Set(q.answer).size !== q.answer.length
    )
      c.addIssue({ code: "custom", message: "Duplicate options or answers" });
    if (q.kind === "single" && q.answer.length !== 1)
      c.addIssue({
        code: "custom",
        message: "Single-choice requires one answer",
      });
    if (q.kind === "ordering" && q.answer.length !== q.options.length)
      c.addIssue({ code: "custom", message: "Ordering must use all options" });
    if (q.kind !== "discussion" && !q.answer.length)
      c.addIssue({ code: "custom", message: "Answer required" });
    if (
      ["single", "multiple", "ordering"].includes(q.kind) &&
      q.answer.some((a) => !q.options.includes(a))
    )
      c.addIssue({ code: "custom", message: "Answer must be an option" });
  });
export const Game = z
  .object({
    id: z.string(),
    title: z.string(),
    template: z.enum([
      "word-race",
      "picture",
      "odd-one-out",
      "mystery-box",
      "brain-battle",
    ]),
    grade: z.number().int().min(6).max(8),
    term: z.number().min(1).max(4),
    topic: z.string(),
    objective: z.string(),
    instructions: z.string(),
    status: z.enum(["draft", "reviewed", "published", "archived"]),
    owner: z.string().nullable(),
    sample: z.boolean(),
    questions: z.array(Question).min(3).max(100),
  })
  .superRefine((g, c) => {
    if (new Set(g.questions.map((q) => q.id)).size !== g.questions.length)
      c.addIssue({ code: "custom", message: "Duplicate question IDs" });
  });
export type GameData = z.infer<typeof Game>;
export type QuestionData = z.infer<typeof Question>;
const q = (
  id: string,
  prompt: string,
  options: string[],
  answer: string[],
  kind: QuestionData["kind"] = "single",
  explanation = "Read the words carefully and compare their meaning.",
): QuestionData => ({ id, prompt, options, answer, kind, explanation });
export const games: GameData[] = [
  {
    id: "word-race",
    title: "Word Race",
    template: "word-race",
    grade: 6,
    term: 1,
    topic: "Everyday life",
    objective:
      "Practise everyday vocabulary and sentence order (sample; no verified official mapping).",
    instructions:
      "Choose the correct word. For a sentence, tap words in order.",
    status: "published",
    owner: null,
    sample: true,
    questions: [
      q(
        "w1",
        "Which word means a place where you borrow books?",
        ["library", "bakery", "stadium"],
        ["library"],
      ),
      q(
        "w2",
        "Put the words in order.",
        ["I", "walk", "to", "school"],
        ["I", "walk", "to", "school"],
        "ordering",
      ),
      q(
        "w3",
        "Write the plural of child.",
        [],
        ["children"],
        "text",
        "The irregular plural of child is children.",
      ),
      q(
        "w4",
        "Choose both school subjects.",
        ["English", "Monday", "Science", "breakfast"],
        ["English", "Science"],
        "multiple",
      ),
    ],
  },
  {
    id: "picture",
    title: "Picture Quest",
    template: "picture",
    grade: 6,
    term: 2,
    topic: "Nature and animals",
    objective: "Describe animals using visual clues (sample).",
    instructions: "Look at the illustration and choose an answer.",
    status: "published",
    owner: null,
    sample: true,
    questions: [
      {
        ...q(
          "p1",
          "Which animal is shown?",
          ["elephant", "tiger", "rabbit"],
          ["elephant"],
        ),
        image: "/elephant.svg",
      },
      q(
        "p2",
        "Which animal can usually fly?",
        ["eagle", "horse", "whale"],
        ["eagle"],
      ),
      q(
        "p3",
        "Describe an animal you like. Give two reasons.",
        [],
        [],
        "discussion",
        "Your teacher will discuss your ideas. There is no single correct answer.",
      ),
    ],
  },
  {
    id: "odd-one-out",
    title: "Odd One Out",
    template: "odd-one-out",
    grade: 7,
    term: 1,
    topic: "Food and healthy habits",
    objective: "Classify vocabulary and explain categories (sample).",
    instructions: "Choose the item that belongs to a different group.",
    status: "published",
    owner: null,
    sample: true,
    questions: [
      q(
        "o1",
        "Which is not a fruit?",
        ["apple", "pear", "carrot", "banana"],
        ["carrot"],
        "single",
        "A carrot is a vegetable.",
      ),
      q(
        "o2",
        "Which is not a sport?",
        ["tennis", "swimming", "reading", "football"],
        ["reading"],
      ),
      q(
        "o3",
        "Which word is not in the past tense?",
        ["went", "played", "eat", "saw"],
        ["eat"],
        "single",
        "Eat is the base form; the past form is ate.",
      ),
    ],
  },
  {
    id: "mystery-box",
    title: "Mystery Box",
    template: "mystery-box",
    grade: 7,
    term: 3,
    topic: "Places and travel",
    objective: "Infer vocabulary from contextual clues (sample).",
    instructions: "Read each clue. Open the mystery by answering.",
    status: "published",
    owner: null,
    sample: true,
    questions: [
      q(
        "m1",
        "I have wings. I carry passengers across the sky. What am I?",
        ["train", "plane", "ship"],
        ["plane"],
      ),
      q(
        "m2",
        "You need me to enter many foreign countries. I show your identity.",
        [],
        ["passport"],
        "text",
      ),
      q(
        "m3",
        "You wait here before boarding a train.",
        ["station", "museum", "hospital"],
        ["station"],
      ),
    ],
  },
  {
    id: "brain-battle",
    title: "Brain Battle",
    template: "brain-battle",
    grade: 8,
    term: 4,
    topic: "Our planet",
    objective: "Discuss environmental choices and practise language (sample).",
    instructions:
      "Think carefully. Some questions have more than one answer. Discussion is not automatically graded.",
    status: "published",
    owner: null,
    sample: true,
    questions: [
      q(
        "b1",
        "Choose two actions that reduce waste.",
        ["reuse a bottle", "drop litter", "repair a bag", "burn plastic"],
        ["reuse a bottle", "repair a bag"],
        "multiple",
      ),
      q(
        "b2",
        "Complete: If we recycle, we ___ less waste.",
        ["will produce", "produced", "producing"],
        ["will produce"],
      ),
      q(
        "b3",
        "What could your class do to protect the environment?",
        [],
        [],
        "discussion",
        "Discuss a realistic action and explain why it would help.",
      ),
    ],
  },
];
for (const g of games) Game.parse(g);
export function score(q: QuestionData, answer: string[]) {
  if (q.kind === "discussion") return null;
  const norm = (a: string) => a.trim().toLowerCase().replace(/\s+/g, " ");
  const a = answer.map(norm),
    b = q.answer.map(norm);
  return q.kind === "ordering"
    ? JSON.stringify(a) === JSON.stringify(b)
    : a.length === b.length &&
        [...a].sort().every((v, i) => v === [...b].sort()[i]);
}
