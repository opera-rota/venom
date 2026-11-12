import { z } from "zod";
import { Id, Timestamp } from "./primitives.ts";
import { Effect } from "./records.ts";
import { contracts } from "./registry.ts";

export const screenLimits = {
  pictureCharacters: 2_000_000,
  pictureSide: 4096,
  marks: 60,
  markName: 120,
  windowTitle: 300,
  appName: 120,
  typedText: 2000,
  scrollSteps: 10,
  pauseSeconds: 10,
  intent: 200,
  seen: 300,
  question: 500,
  answer: 4000,
  reason: 300,
  detail: 300,
  moves: 40,
  guidance: 10,
  thumbnail: 200_000,
  thumbnailWidth: 480,
} as const;

const said = (limit: number) => z.string().min(1).max(limit).regex(/\S/);
const coordinate = z.int().min(0).max(screenLimits.pictureSide);
const markNumber = z.int().min(1).max(screenLimits.marks);

export const ScreenPoint = z
  .strictObject({ x: coordinate, y: coordinate })
  .register(contracts, { id: "ScreenPoint" });

export const ScreenBox = z
  .strictObject({
    x: coordinate,
    y: coordinate,
    width: z.int().min(1).max(screenLimits.pictureSide),
    height: z.int().min(1).max(screenLimits.pictureSide),
  })
  .register(contracts, { id: "ScreenBox" });

export const ScreenMarkKind = z
  .enum(["button", "link", "box", "check", "list", "item", "tab", "menu", "text", "other"])
  .register(contracts, { id: "ScreenMarkKind" });

export const ScreenSpot = z
  .strictObject({
    kind: ScreenMarkKind,
    name: z.string().max(screenLimits.markName),
    password: z.boolean(),
  })
  .register(contracts, { id: "ScreenSpot" });

export const ScreenMark = z
  .strictObject({
    id: markNumber,
    kind: ScreenMarkKind,
    name: z.string().max(screenLimits.markName),
    editable: z.boolean(),
    password: z.boolean(),
    box: ScreenBox,
  })
  .register(contracts, { id: "ScreenMark" });

export const Observation = z
  .strictObject({
    picture: z.string().min(1).max(screenLimits.pictureCharacters).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    width: z.int().min(1).max(screenLimits.pictureSide),
    height: z.int().min(1).max(screenLimits.pictureSide),
    window: z.string().max(screenLimits.windowTitle),
    app: z.string().max(screenLimits.appName),
    marks: z.array(ScreenMark).max(screenLimits.marks),
    focused: markNumber.nullable(),
  })
  .superRefine((seen, context) => {
    if (seen.marks.some((mark, index) => mark.id !== index + 1)) {
      context.addIssue({ code: "custom", path: ["marks"], message: "Marks are numbered 1, 2, 3 and so on, in order." });
    }
    if (seen.focused !== null && seen.focused > seen.marks.length) {
      context.addIssue({ code: "custom", path: ["focused"], message: "The focused mark must be one of the marks." });
    }
  })
  .register(contracts, { id: "Observation" });

export const screenKeys = [
  "enter", "tab", "escape", "backspace", "delete",
  "up", "down", "left", "right", "page_up", "page_down", "home", "end",
  "ctrl+a", "ctrl+c", "ctrl+v", "ctrl+f", "ctrl+l", "ctrl+t", "ctrl+w",
  "alt+left", "alt+tab", "win", "f5",
] as const;

export const ScreenKey = z.enum(screenKeys).register(contracts, { id: "ScreenKey" });

export const ScreenClick = z
  .strictObject({
    name: z.literal("click"),
    mark: markNumber.nullable(),
    point: ScreenPoint.nullable(),
    double: z.boolean(),
  })
  .superRefine((click, context) => {
    if ((click.mark === null) === (click.point === null)) {
      context.addIssue({ code: "custom", path: ["mark"], message: "A click names exactly one of a mark or a point." });
    }
  })
  .register(contracts, { id: "ScreenClick" });

export const ScreenType = z
  .strictObject({
    name: z.literal("type"),
    text: z.string().min(1).max(screenLimits.typedText),
    mark: markNumber.nullable(),
    enter: z.boolean(),
  })
  .register(contracts, { id: "ScreenType" });

export const ScreenKeyPress = z
  .strictObject({
    name: z.literal("key"),
    key: ScreenKey,
  })
  .register(contracts, { id: "ScreenKeyPress" });

export const ScreenScroll = z
  .strictObject({
    name: z.literal("scroll"),
    direction: z.enum(["up", "down"]),
    steps: z.int().min(1).max(screenLimits.scrollSteps),
    mark: markNumber.nullable(),
  })
  .register(contracts, { id: "ScreenScroll" });

export const ScreenOpen = z
  .strictObject({
    name: z.literal("open"),
    app: said(80),
    open: said(400).nullable(),
  })
  .register(contracts, { id: "ScreenOpen" });

export const ScreenPause = z
  .strictObject({
    name: z.literal("pause"),
    seconds: z.int().min(1).max(screenLimits.pauseSeconds),
  })
  .register(contracts, { id: "ScreenPause" });

export const ScreenMove = z
  .discriminatedUnion("name", [ScreenClick, ScreenType, ScreenKeyPress, ScreenScroll, ScreenOpen, ScreenPause])
  .register(contracts, { id: "ScreenMove" });

export const MoveOutcome = z
  .enum(["done", "failed", "refused", "declined", "stopped"])
  .register(contracts, { id: "MoveOutcome" });

export const MoveStatus = z
  .enum(["asking", "running", ...MoveOutcome.options])
  .register(contracts, { id: "MoveStatus" });

export const PastMove = z
  .strictObject({
    intent: said(screenLimits.intent),
    move: ScreenMove,
    outcome: MoveOutcome,
    detail: said(screenLimits.detail),
  })
  .register(contracts, { id: "PastMove" });

export const MakeMove = z
  .strictObject({
    kind: z.literal("move"),
    intent: said(screenLimits.intent),
    effects: z.array(Effect).max(5),
    move: ScreenMove,
  })
  .register(contracts, { id: "MakeMove" });

export const AskUser = z
  .strictObject({ kind: z.literal("ask"), question: said(screenLimits.question) })
  .register(contracts, { id: "AskUser" });

export const GoalDone = z
  .strictObject({ kind: z.literal("done"), answer: said(screenLimits.answer) })
  .register(contracts, { id: "GoalDone" });

export const GoalCannot = z
  .strictObject({ kind: z.literal("cannot"), reason: said(screenLimits.reason) })
  .register(contracts, { id: "GoalCannot" });

export const MoveChoice = z
  .discriminatedUnion("kind", [MakeMove, AskUser, GoalDone, GoalCannot])
  .register(contracts, { id: "MoveChoice" });

export const NextMove = z
  .strictObject({
    seen: said(screenLimits.seen),
    next: MoveChoice,
  })
  .register(contracts, { id: "NextMove" });

export const TaskMove = z
  .strictObject({
    id: Id,
    task_id: Id,
    number: z.int().min(1),
    intent: said(screenLimits.intent),
    seen: said(screenLimits.seen),
    move: ScreenMove,
    effects: z.array(Effect).max(5),
    status: MoveStatus,
    detail: said(screenLimits.detail).nullable(),
    created_at: Timestamp,
    finished_at: Timestamp.nullable(),
  })
  .register(contracts, { id: "TaskMove" });

export const TaskMoves = z
  .strictObject({ moves: z.array(TaskMove).max(screenLimits.moves) })
  .register(contracts, { id: "TaskMoves" });

export const Thumbnail = z
  .string()
  .min(1)
  .max(screenLimits.thumbnail)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/)
  .register(contracts, { id: "Thumbnail" });

export type ScreenPoint = z.infer<typeof ScreenPoint>;
export type ScreenBox = z.infer<typeof ScreenBox>;
export type ScreenMarkKind = z.infer<typeof ScreenMarkKind>;
export type ScreenSpot = z.infer<typeof ScreenSpot>;
export type ScreenMark = z.infer<typeof ScreenMark>;
export type Observation = z.infer<typeof Observation>;
export type ScreenKey = z.infer<typeof ScreenKey>;
export type ScreenClick = z.infer<typeof ScreenClick>;
export type ScreenType = z.infer<typeof ScreenType>;
export type ScreenKeyPress = z.infer<typeof ScreenKeyPress>;
export type ScreenScroll = z.infer<typeof ScreenScroll>;
export type ScreenOpen = z.infer<typeof ScreenOpen>;
export type ScreenPause = z.infer<typeof ScreenPause>;
export type ScreenMove = z.infer<typeof ScreenMove>;
export type MoveOutcome = z.infer<typeof MoveOutcome>;
export type MoveStatus = z.infer<typeof MoveStatus>;
export type TaskMove = z.infer<typeof TaskMove>;
export type TaskMoves = z.infer<typeof TaskMoves>;
export type Thumbnail = z.infer<typeof Thumbnail>;
export type PastMove = z.infer<typeof PastMove>;
export type MakeMove = z.infer<typeof MakeMove>;
export type AskUser = z.infer<typeof AskUser>;
export type GoalDone = z.infer<typeof GoalDone>;
export type GoalCannot = z.infer<typeof GoalCannot>;
export type MoveChoice = z.infer<typeof MoveChoice>;
export type NextMove = z.infer<typeof NextMove>;
