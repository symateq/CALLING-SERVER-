import { z } from "zod";

// Shared string-enum definitions matching the `/// "A" | "B"` comments in
// prisma/schema.prisma (SQLite has no native enum type). Stage 2 only wires
// up Platform via the devices routes; the rest are declared here now so
// Stage 3/4 call, transcript and reminder routes validate against the same
// single source of truth instead of re-typing the value lists.

export const PlatformSchema = z.enum(["ANDROID", "WINDOWS"]);
export const DirectionSchema = z.enum(["INBOUND", "OUTBOUND"]);
export const CallEndReasonSchema = z.enum([
  "ANSWERED",
  "NO_ANSWER",
  "BUSY",
  "FAILED",
  "CANCELED",
  "ANSWERED_ELSEWHERE",
]);
export const LegStatusSchema = z.enum(["RINGING", "ANSWERED", "DECLINED", "MISSED", "CANCELED"]);
export const OutcomeTypeSchema = z.enum([
  "INTERESTED",
  "SEND_INFORMATION",
  "CALLBACK_REQUESTED",
  "MEETING_BOOKED",
  "NO_ANSWER",
  "BUSY",
  "NOT_INTERESTED",
  "WRONG_NUMBER",
  "DO_NOT_CALL",
  "OTHER",
]);
export const TranscriptStatusSchema = z.enum(["LIVE", "FINALIZED", "PARTIAL", "FAILED"]);
export const SpeakerSchema = z.enum(["LOCAL", "REMOTE", "UNKNOWN"]);
export const ReminderStatusSchema = z.enum(["PENDING", "SNOOZED", "DONE"]);
export const DeliveryChannelSchema = z.enum(["PUSH", "LOCAL_ALARM"]);
