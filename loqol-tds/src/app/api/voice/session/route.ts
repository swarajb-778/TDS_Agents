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
            /*
             * server_vad rather than semantic_vad, and this is a trade.
             *
             * semantic_vad is the better judge of when someone has finished a
             * thought, which is why it was the first choice. But its onset
             * detection is not tunable — `eagerness` only says how patiently it
             * waits for you to finish, not how loud a sound has to be before it
             * counts as you starting. A cough or a passing car still registered
             * as the seller speaking, which truncated the agent mid-question.
             *
             * server_vad exposes the knob that actually matters here. 0.8 needs
             * clearly audible speech and ignores room tone; 1500ms of silence
             * before a turn ends leaves room to think, which is the whole point
             * of routing these questions to voice. Interruption stays ON — a
             * seller must be able to cut in with "wait, what?" — it is just
             * much harder to trigger by accident.
             */
            turn_detection: {
              type: "server_vad",
              threshold: 0.8,
              prefix_padding_ms: 500,
              silence_duration_ms: 1500,
            },
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
