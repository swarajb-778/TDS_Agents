"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getChapter } from "@/tds/registry";
import type { ChapterId } from "@/tds/types";

/**
 * The voice path. Entirely in the browser over WebRTC — no phone, no number.
 *
 * The model talks; it does not decide. Every tool call goes to /api/voice/tool,
 * which validates the write against the registry and answers with the next
 * question. What comes back is what gets asked.
 */

type Line = { who: "seller" | "agent" | "system"; text: string };

interface Props {
  token: string;
  chapter: ChapterId;
  onSwitchToForm: (questionId: string) => void;
  /** Voice writes land server-side; tell the flow to pull the map back. */
  onWrote?: () => void;
}

type Status = "idle" | "connecting" | "live" | "ended" | "error";

export function VoiceChapter({ token, chapter, onSwitchToForm, onWrote }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [recorded, setRecorded] = useState<string[]>([]);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);

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
  }, []);

  useEffect(() => stop, [stop]);

  const send = (event: unknown) => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") dc.send(JSON.stringify(event));
  };

  /** Run a tool call on the server and hand the result back to the model. */
  const runTool = useCallback(
    async (callId: string, name: string, rawArgs: string) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(rawArgs || "{}");
      } catch {
        /* the model sent malformed JSON; the server will reject it */
      }

      let result: Record<string, unknown>;
      try {
        const response = await fetch("/api/voice/tool", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, name, args }),
        });
        result = await response.json();
      } catch {
        result = { ok: false, reason: "Could not reach the server. Ask again in a moment." };
      }

      if (typeof result.recorded === "string") {
        setRecorded((p) => [...p, result.recorded as string]);
        onWrote?.();
      }
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
        setTimeout(() => {
          stop();
          onSwitchToForm(result.hand_off_to_form as string);
        }, 900);
        return;
      }

      send({ type: "response.create" });
    },
    [token, say, stop, onSwitchToForm, onWrote],
  );

  const start = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    try {
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, chapter }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not start.");
      const session = await res.json();
      setProgressLabel(session.progressLabel ?? null);

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
        send({ type: "response.create" });
      });

      dc.addEventListener("message", (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        const type = String(msg.type ?? "");

        if (type === "response.function_call_arguments.done") {
          void runTool(String(msg.call_id), String(msg.name), String(msg.arguments ?? "{}"));
          return;
        }
        // The seller must be able to see what is being recorded about them.
        if (type === "conversation.item.input_audio_transcription.completed") {
          say("seller", String(msg.transcript ?? ""));
          return;
        }
        if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
          say("agent", String(msg.transcript ?? ""));
          return;
        }
        if (type === "error") {
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
  }, [token, chapter, runTool, say, stop]);

  const title = getChapter(chapter)?.title ?? "";
  const intro = getChapter(chapter)?.intro ?? "";

  return (
    <div className="mx-auto max-w-lg px-4 pb-40 pt-6">
      <audio ref={audioRef} autoPlay className="hidden" />

      <p className="text-sm font-medium text-stone-500">{title}</p>
      <h1 className="mt-1 text-2xl font-semibold text-stone-900">
        {status === "live" ? "Go ahead — I'm listening" : "Let's talk this bit through"}
      </h1>
      <p className="mt-2 text-stone-600">{intro}</p>
      {progressLabel && <p className="mt-1 text-sm text-stone-400">{progressLabel}</p>}

      {status === "idle" && (
        <button
          type="button"
          onClick={start}
          className="mt-6 min-h-14 w-full rounded-xl bg-teal-700 px-5 text-base font-semibold text-white active:bg-teal-800"
        >
          Start talking
        </button>
      )}
      {status === "connecting" && (
        <p className="mt-6 text-stone-500">Connecting — your browser will ask for the microphone.</p>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {error}
          <button type="button" onClick={start} className="ml-2 font-semibold underline">
            Try again
          </button>
        </div>
      )}

      {lines.length > 0 && (
        <div className="mt-6 space-y-3">
          {lines.map((line, i) => (
            <div
              key={i}
              className={
                line.who === "seller"
                  ? "ml-8 rounded-2xl bg-teal-700 px-4 py-2 text-white"
                  : line.who === "agent"
                    ? "mr-8 rounded-2xl bg-white px-4 py-2 text-stone-800 ring-1 ring-stone-200"
                    : "text-sm text-stone-500"
              }
            >
              {line.text}
            </div>
          ))}
          <div ref={transcriptEnd} />
        </div>
      )}

      {recorded.length > 0 && (
        <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-sm font-medium text-stone-500">Written down so far</p>
          <ul className="mt-2 space-y-1">
            {recorded.map((r, i) => (
              <li key={i} className="text-sm text-stone-700">
                &middot; {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Always reachable, in every state. A seller who blocked the microphone,
        or whose connection failed, must never be stranded on a screen whose
        only control needs a microphone.
      */}
      <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-lg gap-2">
          <button
            type="button"
            onClick={() => {
              stop();
              setStatus("ended");
              onSwitchToForm("");
            }}
            className="min-h-14 flex-1 rounded-xl border-2 border-stone-300 bg-white px-4 font-medium text-stone-700"
          >
            Just show me the buttons
          </button>
          {status === "live" && (
            <button
              type="button"
              onClick={() => {
                stop();
                setStatus("ended");
              }}
              className="min-h-14 rounded-xl border-2 border-stone-300 bg-white px-4 font-medium text-stone-700"
            >
              Pause
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
