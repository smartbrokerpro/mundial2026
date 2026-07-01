import mongoose, { Schema, Model } from "mongoose";
import type { TeamDoc, MatchDoc } from "./types";

const TeamSchema = new Schema<TeamDoc>(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    flag: { type: String, default: "🏳️" },
    group: { type: String, default: null, index: true },
  },
  { timestamps: true }
);

const MatchSchema = new Schema<MatchDoc>(
  {
    matchId: { type: String, required: true, unique: true, index: true },
    stage: { type: String, required: true, index: true },
    group: { type: String, default: null, index: true },
    slot: { type: String, required: true },
    nextSlot: { type: String, default: null },
    nextSlotSide: { type: String, default: null },
    homePlaceholder: { type: String, default: "" },
    awayPlaceholder: { type: String, default: "" },
    homeCode: { type: String, default: null },
    awayCode: { type: String, default: null },
    homeScore: { type: Number, default: null },
    awayScore: { type: Number, default: null },
    homePens: { type: Number, default: null },
    awayPens: { type: Number, default: null },
    status: { type: String, default: "SCHEDULED" },
    minute: { type: Number, default: null },
    utcDate: { type: String, required: true },
    venue: { type: String, default: "" },
  },
  { timestamps: true }
);

// En Next/dev el módulo se recarga: reutiliza el modelo si ya existe.
export const Team: Model<TeamDoc> =
  (mongoose.models.Team as Model<TeamDoc>) ||
  mongoose.model<TeamDoc>("Team", TeamSchema);

export const Match: Model<MatchDoc> =
  (mongoose.models.Match as Model<MatchDoc>) ||
  mongoose.model<MatchDoc>("Match", MatchSchema);
