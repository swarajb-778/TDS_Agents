/**
 * Mints a short-lived OpenAI Realtime token for the browser.
 *
 * The standing API key never leaves the server. The ephemeral key is scoped to
 * one session and expires on its own, and this route will only mint one for a
 * caller holding a valid magic-link token.
 */

import { NextResponse } from "next/server";
import { resolveSellerToken } from "@/db/requests";
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

  let body: { token?: unknown; chapter?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  if (typeof body.token !== "string") {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const session = await resolveSellerToken(body.token);
  if (!session) {
    return NextResponse.json({ error: "This link is no longer valid." }, { status: 401 });
  }

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
        instructions: voiceInstructions(chapter, firstName),
        tools: realtimeTools(),
        tool_choice: "auto",
        audio: {
          input: { transcription: { model: "whisper-1" } },
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
