"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getChapter } from "@/tds/registry";
import { isLikelyHallucination } from "@/tds/voice";
import {
  INITIAL_TURN,
  isActiveResponseClash,
  isPending,
  step,
  type TurnEvent,
  type TurnState,
} from "@/tds/voice-turns";
import { Button, Card, Pending } from "@/app/ui";
import type { ChapterId } from "@/tds/types";

/**
 * The voice path. Entirely in the browser over WebRTC — no phone, no number.
 *
 * The model talks; it does not decide. Every tool call goes to /api/voice/tool,
 * which validates the write against the registry and answers with the next
 * question. What comes back is what gets asked.
 *
 * What this file is careful about is the *transport*: the Realtime API allows
 * one open response at a time and silently refuses a second, so asking the
 * agent to speak is routed through voice-turns.ts rather than fired off
 * hopefully after each tool call. See that file for why.
 */

type Line = { who: "seller" | "agent" | "system"; text: string };

/** The chapter is over. What the seller is told, and where the button goes. */
interface Finished {
  heading: string;
  detail: string;
  cta: string;
}

interface Props {
  chapter: ChapterId;
  /**
   * Hand over to the on-screen version, naming the question being discussed.
   *
   * The id is the seller's *place*, not their position in the queue — the form
   * scrolls there and marks it, and flow.ts still decides what actually gets
   * asked. An empty string is a legitimate answer to "which question": the call
   * may have dropped before the first one arrived, and the form opens at the
   * top rather than refusing to open.
   */
  onSwitchToForm: (questionId: string) => void;
  /**
   * This chapter's conversation is over — pull the answers back and move on.
   *
   * Deliberately not called per answer. The parent derives both the chapter and
   * the modality from the answer set, so refreshing mid-conversation can change
   * what it renders and tear this component down with the agent still talking.
   * Voice writes are already safe on the server; nothing is lost by waiting
   * until the seller taps through.
   */
  onAdvance?: () => void;
}

type Status = "idle" | "connecting" | "live" | "ended" | "error";

/** How often the watchdog asks whether the seller has been left in silence. */
const NUDGE_INTERVAL_MS = 2_000;

export function VoiceChapter({ chapter, onSwitchToForm, onAdvance }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [recorded, setRecorded] = useState<string[]>([]);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turnLabel, setTurnLabel] = useState<string | null>(null);
  /**
   * The seller has stopped speaking and the agent has not started. Separate
   * from the turn state on purpose: nothing is owed or in flight yet, but the
   * seller is still sitting in silence and that is the bit that reads as a hang.
   */
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [finished, setFinished] = useState<Finished | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);
  const turnRef = useRef<TurnState>(INITIAL_TURN);
  /**
   * What the conversation is on right now, as the server last reported it.
   *
   * A ref rather than state: nothing renders from it, and re-rendering this
   * component on every tool call is exactly the class of change that has torn
   * down a live call before. It exists so that "just show me the buttons" can
   * say *which* question, instead of dumping the seller at the top of a chapter
   * they were fifty questions into.
   */
  const onQuestion = useRef<string>("");

  const say = useCallback((who: Line["who"], text: string) => {
    if (!text.trim()) return;
    setLines((prev) => [...prev, { who, text: text.trim() }]);
  }, []);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const stop = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    dcRef.current = null;
    pcRef.current = null;
    streamRef.current = null;
    turnRef.current = INITIAL_TURN;
    setTurnLabel(null);
    setAwaitingReply(false);
  }, []);

  useEffect(() => stop, [stop]);

  const send = useCallback((event: unknown) => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") dc.send(JSON.stringify(event));
  }, []);

  /**
   * The single place a `response.create` can come from. The reducer decides
   * whether now is a legal moment; nothing else in this file sends one.
   */
  const dispatch = useCallback(
    (event: TurnEvent) => {
      const { state, createResponse } = step(turnRef.current, event, Date.now());
      turnRef.current = state;
      setTurnLabel(
        state.outstanding.length > 0
          ? "Writing that down…"
          : isPending(state)
            ? "One moment…"
            : null,
      );
      if (createResponse) send({ type: "response.create" });
    },
    [send],
  );

  // The watchdog. If a reply is owed, nothing is speaking, and enough time has
  // passed since we last asked, the reducer sends again. A seller must never be
  // left sitting in silence waiting for a turn that was quietly refused.
  useEffect(() => {
    if (status !== "live") return;
    const timer = setInterval(() => dispatch({ type: "nudge" }), NUDGE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status, dispatch]);

  /** Run a tool call on the server and hand the result back to the model. */
  const runTool = useCallback(
    async (callId: string, name: string, rawArgs: string) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(rawArgs || "{}");
      } catch {
        /* the model sent malformed JSON; the server will reject it */
      }

      dispatch({ type: "tool.called", callId });

      let result: Record<string, unknown>;
      try {
        const response = await fetch("/api/voice/tool", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, args }),
        });
        result = await response.json();
      } catch {
        result = { ok: false, reason: "Could not reach the server. Ask again in a moment." };
      }

      // The server names what comes next, on every tool result — including a
      // rejected write, which names the question again so the agent re-asks it.
      // Following it here keeps the handoff pointing at the live question.
      if (typeof result.next_question_id === "string" && result.next_question_id) {
        onQuestion.current = result.next_question_id;
      }

      if (typeof result.recorded === "string") setRecorded((p) => [...p, result.recorded as string]);
      if (typeof result.progress === "string") setProgressLabel(result.progress);
      if (result.ok === false && typeof result.reason === "string") {
        say("system", `Not recorded — ${result.reason}`);
      }
      if (typeof result.note === "string") say("system", result.note);

      send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result) },
      });

      if (typeof result.hand_off_to_form === "string") {
        // No pushback, no "are you sure". Hand over.
        dispatch({ type: "tool.settled", callId });
        // Settle first, then stand down: tool.settled would otherwise re-raise
        // the want this clears. The agent gets its one goodbye and no more.
        dispatch({ type: "reply.abandoned" });
        // The model names the question it was on; the server's own answer is
        // the fallback, because a model that forgot to name one must not cost
        // the seller their place.
        const place = (result.hand_off_to_form as string) || onQuestion.current;
        setTimeout(() => {
          stop();
          onSwitchToForm(place);
        }, 900);
        return;
      }

      // The server, not the agent, decides that this part is over — and the
      // seller is told so on screen rather than being left to infer it from the
      // agent going quiet.
      if (result.done === true) {
        setFinished({
          heading: "That’s everything.",
          detail: "Nothing left to ask. You can look it all over before you sign.",
          cta: "Review and sign",
        });
      } else if (result.entering_chapter === true) {
        const nextTitle =
          typeof result.next_chapter === "string"
            ? (getChapter(result.next_chapter as ChapterId)?.title ?? null)
            : null;
        setFinished({
          heading: "That’s this part done.",
          detail: nextTitle ? `Next: ${nextTitle}.` : "There’s one more part to go.",
          cta: "Keep going",
        });
      }

      dispatch({ type: "tool.settled", callId });
    },
    [say, send, dispatch, stop, onSwitchToForm],
  );

  const start = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    setFinished(null);
    turnRef.current = INITIAL_TURN;
    try {
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapter }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not start.");
      const session = await res.json();
      setProgressLabel(session.progressLabel ?? null);
      // Where the conversation opens, so a seller who bails out in the first
      // ten seconds still lands on the question they were just asked.
      if (typeof session.firstQuestionId === "string") {
        onQuestion.current = session.firstQuestionId;
      }

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (e) => {
        if (audioRef.current) audioRef.current.srcObject = e.streams[0];
      };

      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = mic;
      pc.addTrack(mic.getTracks()[0], mic);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.addEventListener("open", () => {
        setStatus("live");
        // Open the conversation rather than waiting to be spoken to.
        dispatch({ type: "reply.wanted" });
      });

      dc.addEventListener("message", (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        const type = String(msg.type ?? "");

        // The seller finished their turn. Everything from here until the agent
        // is audibly speaking is dead air, so it gets an indicator.
        if (type === "input_audio_buffer.speech_stopped") {
          setAwaitingReply(true);
          return;
        }
        if (type.startsWith("response.output_audio") || type.startsWith("response.audio_transcript")) {
          setAwaitingReply(false);
        }

        // The response lifecycle. Tracked, not assumed — this is the whole
        // reason the agent now reliably moves on to the next question.
        if (type === "response.created") {
          dispatch({ type: "response.created" });
          return;
        }
        if (type === "response.done") {
          setAwaitingReply(false);
          dispatch({ type: "response.done" });
          return;
        }

        if (type === "response.function_call_arguments.done") {
          void runTool(String(msg.call_id), String(msg.name), String(msg.arguments ?? "{}"));
          return;
        }
        // The seller must be able to see what is being recorded about them —
        // which is exactly why words they never said must not appear here.
        // Transcribers hallucinate stock phrases on room noise; see
        // isLikelyHallucination.
        if (type === "conversation.item.input_audio_transcription.completed") {
          const transcript = String(msg.transcript ?? "");
          if (!isLikelyHallucination(transcript)) say("seller", transcript);
          return;
        }
        if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
          say("agent", String(msg.transcript ?? ""));
          return;
        }
        if (type === "error") {
          // "You already have a response open" is our timing problem, not the
          // seller's news. Record it so the reducer can re-send once the floor
          // is free, and say nothing.
          if (isActiveResponseClash(msg.error)) {
            dispatch({ type: "response.rejected" });
            return;
          }
          const detail = (msg.error as { message?: string } | undefined)?.message;
          setError(detail ?? "Something went wrong on the call.");
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdp = await fetch(`https://api.openai.com/v1/realtime/calls?model=${session.model}`, {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/sdp" },
      });
      if (!sdp.ok) throw new Error("Could not connect the call.");

      await pc.setRemoteDescription({ type: "answer", sdp: await sdp.text() });
    } catch (e) {
      stop();
      setStatus("error");
      const denied =
        e instanceof DOMException &&
        (e.name === "NotAllowedError" || e.name === "NotFoundError");
      setError(
        denied
          ? "I can't hear you — your browser is blocking the microphone. You can allow it and try again, or answer these on screen instead."
          : e instanceof Error
            ? e.message
            : "Could not start the conversation.",
      );
    }
  }, [chapter, runTool, dispatch, stop]);

  const advance = useCallback(() => {
    stop();
    setStatus("ended");
    onAdvance?.();
  }, [stop, onAdvance]);

  // A tool call in flight outranks plain dead air — it is the more specific
  // truth about what the seller is waiting for. Once this part is done the
  // button is the answer to "what now?", so the indicator stands down.
  const pendingLabel = finished ? null : (turnLabel ?? (awaitingReply ? "One moment…" : null));

  const title = getChapter(chapter)?.title ?? "";
  const intro = getChapter(chapter)?.intro ?? "";

  return (
    <div className="mx-auto max-w-lg px-4 pb-40 pt-6">
      <audio ref={audioRef} autoPlay className="hidden" />

      <p className="text-sm font-medium text-ink-muted">{title}</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink">
        {finished
          ? finished.heading
          : status === "live"
            ? "Go ahead — I'm listening"
            : "Let's talk this bit through"}
      </h1>
      <p className="mt-2 text-ink-muted">{finished ? finished.detail : intro}</p>
      {progressLabel && <p className="mt-1 text-sm text-ink-faint">{progressLabel}</p>}

      {/* Pausing must not be a dead end — there is always a way back in. */}
      {(status === "idle" || (status === "ended" && !finished)) && (
        <Button full className="mt-6" onClick={start}>
          {status === "ended" ? "Pick this back up" : "Start talking"}
        </Button>
      )}
      {status === "connecting" && (
        <p className="mt-6 text-ink-muted">Connecting — your browser will ask for the microphone.</p>
      )}

      {error && (
        <Card tone="attention" className="mt-4">
          <p className="text-sm text-attention">{error}</p>
          <Button variant="secondary" size="md" className="mt-3" onClick={start}>
            Try again
          </Button>
        </Card>
      )}

      {lines.length > 0 && (
        <div className="mt-6 space-y-3">
          {lines.map((line, i) => (
            <div
              key={i}
              className={
                line.who === "seller"
                  ? "ml-8 rounded-card bg-brand px-4 py-2 text-on-brand"
                  : line.who === "agent"
                    ? "mr-8 rounded-card bg-surface px-4 py-2 text-ink ring-1 ring-line"
                    : "text-sm text-ink-muted"
              }
            >
              {line.text}
            </div>
          ))}
          <div ref={transcriptEnd} />
        </div>
      )}

      {/*
        The round trip runs to several seconds. Left unannounced it reads as a
        hang, and a seller who thinks it has died stops waiting.
      */}
      {pendingLabel && (
        <div className="mt-4">
          <Pending label={pendingLabel} />
        </div>
      )}

      {recorded.length > 0 && (
        <Card className="mt-6">
          <p className="text-sm font-medium text-ink-muted">Written down so far</p>
          <ul className="mt-2 space-y-1">
            {recorded.map((r, i) => (
              <li key={i} className="text-sm text-ink">
                &middot; {r}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/*
        Always reachable, in every state. A seller who blocked the microphone,
        or whose connection failed, must never be stranded on a screen whose
        only control needs a microphone.
      */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-lg gap-2">
          {finished ? (
            <Button full onClick={advance}>
              {finished.cta}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                full
                onClick={() => {
                  stop();
                  setStatus("ended");
                  // Carry the question over. Tapping this used to land the
                  // seller at the top of the chapter, which in a fifty-question
                  // one is barely better than starting again.
                  onSwitchToForm(onQuestion.current);
                }}
              >
                Just show me the buttons
              </Button>
              {status === "live" && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    stop();
                    setStatus("ended");
                  }}
                >
                  Pause
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
