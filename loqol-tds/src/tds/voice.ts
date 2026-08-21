/**
 * VOICE
 *
 * The agent's brief, derived from the registry. Pure — no network, no React —
 * so the instructions can be asserted in a script.
 *
 * The model does not own the state machine. It gets tools; flow.ts owns the
 * queue and validateAnswer() guards every write. These instructions exist to
 * make the *conversation* good, not to let the model decide what happens next.
 */

import { getChapter, questionsInChapter } from "./registry";
import { followUpId, isVisible, voiceToolSchemas } from "./flow";
import type { AnswerMap, ChapterId, Question } from "./types";

/** One question, as the agent needs to understand it. */
function brief(q: Question, answers: AnswerMap): string {
  const existing = answers[q.id];
  // A question already answered — in this chapter, on the other path, or in an
  // earlier session — must be marked. Without this the agent reads the chapter
  // from the top and re-asks things the seller has already tapped, which is
  // both irritating and a reason to distrust everything else it says.
  if (existing && existing.status !== "unanswered") {
    const said =
      existing.status === "answered"
        ? JSON.stringify(existing.value)
        : existing.status.replace(/_/g, " ");
    return `${q.id}: ALREADY ANSWERED (${said}) — do not ask this again.`;
  }
  const lines = [`${q.id}: ${q.sellerLabel ?? q.label}`];
  if (q.voicePrompt) lines.push(`  ask: ${q.voicePrompt}`);
  if (q.plainEnglish) lines.push(`  means: ${q.plainEnglish}`);
  if (q.whyWeAsk) lines.push(`  why: ${q.whyWeAsk}`);
  if (q.examples?.length) lines.push(`  examples: ${q.examples.join("; ")}`);
  if (q.followUp) {
    lines.push(
      `  if ${JSON.stringify(q.followUp.when)}: ${q.followUp.voicePrompt ?? q.followUp.prompt} -> record_explanation("${followUpId(q.id)}")`,
    );
  }
  return lines.join("\n");
}

export function chapterBrief(chapter: ChapterId, answers: AnswerMap): string {
  return questionsInChapter(chapter)
    .filter((q) => q.defaultModality !== "agent")
    .map((q) => brief(q, answers))
    .join("\n\n");
}

/**
 * The system prompt.
 *
 * Two rules here are not style preferences and are stated as absolutes: never
 * invent a fact the seller did not say, and never decide the order yourself.
 * This document is signed under penalty of perjury and the audit trail records
 * the model's confidence on every write.
 */
export function voiceInstructions(
  chapter: ChapterId,
  sellerFirstName: string,
  answers: AnswerMap,
): string {
  const c = getChapter(chapter);
  /*
   * Chapter-scoped, deliberately. nextQuestion() answers a different question —
   * where is the seller in the whole form — and this session only covers one
   * part. Using the global next would point the agent at a question that is not
   * even on its brief.
   */
  const start = questionsInChapter(chapter)
    .filter((q) => q.defaultModality !== "agent" && isVisible(q, answers))
    .find((q) => {
      const a = answers[q.id];
      return !a || a.status === "unanswered";
    });

  return `You are helping ${sellerFirstName} fill in part of a California Transfer Disclosure Statement, out loud, over their phone or laptop. They are probably tired, they are not a lawyer, and they did not choose to do this. Be warm, brief, and unhurried.

# The single most important rule

Never write down a fact the seller did not say. When you draft an explanation, use their words, tidied only for grammar. Do not add a cause, a date, a cost, or a severity they did not give you. If an explanation feels thin, that is fine — thin and true beats complete and invented. A person signs this under penalty of perjury.

# How this works

You do not decide what comes next. Every tool result comes back with a \`next_prompt\` field. That is the next question, chosen by the server. The moment you have a tool result, ask \`next_prompt\` out loud — do not summarise it, do not ask whether they are ready, do not wait to be prompted. A short acknowledgement first is fine ("Got it.") but it must be followed in the same breath by the question. If you think the order is wrong, say so out loud to the seller, but still follow it.

If \`next_prompt\` comes back empty and \`done\` or \`entering_chapter\` is true, this part of the form is finished. Say one short line to close it off and then stop talking. Do not start on anything else — there is a button on screen for what comes next, and you have not been briefed on it.

Call one tool at a time and wait for its result before calling another. Two tool calls in one turn collide and the seller ends up sitting in silence.

Ask ONE question at a time. Use the "ask" wording below as your starting point — you may rephrase to sound natural or to follow up, but do not merge two questions into one.

# When they do not understand

Most of these questions are written in legal language. That is the problem you are here to solve. Use "means", "why" and "examples" below. Give a concrete example rather than a definition — "a neighbour's fence that crosses onto your land" beats "an encroachment".

You are not a lawyer and must not give legal advice. If they need advice, say you will flag it for their agent, and call flag_for_agent.

# When they do not know

"I don't know" is a real answer here, not a failure. But before you record it, check one thing: this form asks what the SELLER is aware of. Very often "I don't know" actually means "no, I'm not aware of any" — and those are different answers. Ask which they mean, plainly and without pushing:

  "Just so I get this right — do you mean you're not aware of any, or that you genuinely aren't sure?"

If they are genuinely unsure, call mark_unknown and reassure them it goes to their agent, which is normal.

# When they say yes

A yes on its own is not usable. Capture the explanation immediately, while they still have it in mind — not at the end. Call record_explanation before you move on.

# When they want to stop talking

If they would rather tap buttons, call switch_to_form straight away. Do not talk them out of it, do not ask why, do not offer to keep going. "Of course — I'll put that on screen for you" and move on.

# When you hear nothing

Microphones pick up fans, traffic and coughs, and a turn can arrive carrying no
actual speech. If a turn has no intelligible words in it, or is only a stray
"thank you" or "bye" that answers nothing you asked, say nothing at all and keep
waiting. Do not fill the gap, do not say goodbye, do not repeat the question
immediately, and never record an answer from it. A seller who has gone quiet is
thinking, not finished.

# Confidence

The confidence you pass on record_answer is real and it is checked. Below 0.75 the write is rejected and you will be told to ask again. If they hedged, said "I think so", or trailed off, that is not a 0.9. Ask again rather than guessing.

# Where to start

${
  start
    ? `Begin with ${start.id}. Anything marked ALREADY ANSWERED below is done — the seller may have tapped it on screen, or answered it in an earlier sitting. Do not ask it again. If you need to confirm one of them, do it once at the end, not as you go.`
    : "Everything in this part is answered. Say so, briefly, and stop."
}

# ${c?.title ?? chapter}

${c?.intro ?? ""}

${chapterBrief(chapter, answers)}`;
}

/** Realtime wants `type: "function"` alongside the schema flow.ts already owns. */
export function realtimeTools() {
  return voiceToolSchemas().map((t) => ({ type: "function" as const, ...t }));
}

// ---------------------------------------------------------------------------
// Transcript hygiene
// ---------------------------------------------------------------------------

/**
 * Speech-to-text models hallucinate on non-speech audio. Whisper in particular
 * was trained on subtitled video, so a few seconds of room tone reliably
 * produces "Thank you for watching" — in Japanese if the language is not
 * pinned. Measured, not guessed: five seconds of synthetic room noise returns
 * "ご視聴ありがとうございました" three times out of three.
 *
 * Left alone, that lands in the seller's own transcript looking like something
 * they said. On a document signed under penalty, words the seller never spoke
 * must never appear attributed to them.
 *
 * This is display-only defence. The real fix is upstream — noise reduction and
 * a turn detector that does not treat a cough as a sentence — but a filter
 * costs nothing and catches whatever gets through.
 */
const HALLUCINATIONS = [
  "thank you for watching",
  "thanks for watching",
  "thank you for your watching",
  "ご視聴ありがとうございました",
  "ご清聴ありがとうございました",
  "please subscribe",
  "subscribe to my channel",
  "like and subscribe",
  "amara.org",
  "subtitles by",
  "the end",
  "blank_audio",
  "silence",
  "music",
  "applause",
];

/** Turns that are only filler, and cannot be an answer to anything. */
const EMPTY_TURNS = ["thank you", "thanks", "bye", "bye bye", "goodbye", "you", "okay", "ok"];

export function isLikelyHallucination(transcript: string): boolean {
  const text = transcript.trim().toLowerCase();
  if (!text) return true;

  // Punctuation, bracketed stage directions, or a lone stray character.
  const words = text.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  if (!words) return true;
  if (/^[\[(].*[\])]$/.test(text)) return true;

  if (HALLUCINATIONS.some((h) => words.includes(h))) return true;

  // A bare "thank you" is not an answer to any question on this form. If the
  // seller really did say only that, they lose nothing by it not being shown.
  return EMPTY_TURNS.includes(words);
}
