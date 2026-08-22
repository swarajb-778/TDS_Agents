/**
 * Mints a short-lived OpenAI Realtime token for the browser.
 *
 * The standing API key never leaves the server. The ephemeral key is scoped to
 * one session and expires on its own, and this route will only mint one for a
 * browser carrying a live seller session cookie.
 */

import { NextResponse } from "next/server";
import { sellerForMutation } from "@/db/seller-guard";
import { loadAnswers } from "@/db/answers";
import { nextQuestion, progress } from "@/tds/flow";
import { realtimeTools, voiceInstructions } from "@/tds/voice";
import type { ChapterId } from "@/tds/types";

const MODEL = "gpt-realtime-2.1";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Voice is not configured." }, { status: 503 });
  }

  let body: { chapter?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  const auth = await sellerForMutation();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const session = auth.session;

  const answers = await loadAnswers(session.dealId);
  const next = nextQuestion(answers);
  const chapter = (typeof body.chapter === "string" ? body.chapter : next.chapter) as ChapterId;
  if (!chapter) {
    return NextResponse.json({ error: "Nothing left to talk about." }, { status: 409 });
  }

  const firstName = session.sellerName.split(" ")[0];

  const minted = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: MODEL,
        instructions: voiceInstructions(chapter, firstName, answers),
        tools: realtimeTools(),
        tool_choice: "auto",
        audio: {
          input: {
            /*
             * Room tone is not speech, and three things here stop it being
             * treated as speech.
             *
             * near_field noise reduction runs before both the turn detector
             * and the transcriber, so a fan or a laptop hum never reaches
             * either.
             *
             * semantic_vad decides the turn is over using a model rather than
             * an energy threshold, which matters twice: a cough no longer ends
             * a turn, and a seller pausing to think is no longer interrupted.
             * "low" eagerness waits longer before concluding they are done —
             * correct for someone recalling whether the patio ever cracked.
             *
             * And the language is pinned. Unpinned, whisper renders a few
             * seconds of room noise as "ご視聴ありがとうございました" —
             * "thank you for watching", learned from subtitled video. Pinned to
             * English the same audio comes back as ". ". Measured, three runs
             * each. Note that adding a `prompt` here makes it markedly worse:
             * it primes the model to produce a well-formed sentence, and the
             * hallucination returns in English.
             */
            noise_reduction: { type: "near_field" },
            turn_detection: { type: "semantic_vad", eagerness: "low" },
            transcription: { model: "whisper-1", language: "en" },
          },
          output: { voice: "marin" },
        },
      },
    }),
  });

  const text = await minted.text();
  if (!minted.ok) {
    // Never surface the upstream body — it can echo request detail.
    console.error("realtime token mint failed", minted.status, text.slice(0, 400));
    return NextResponse.json({ error: "Could not start the conversation." }, { status: 502 });
  }

  const { value, expires_at } = JSON.parse(text);

  return NextResponse.json({
    token: value,
    expiresAt: expires_at,
    model: MODEL,
    chapter,
    firstQuestionId: next.question?.id ?? null,
    progressLabel: progress(answers).label,
  });
}
