/**
 * VOICE TURNS — who is allowed to speak, and when.
 *
 * The Realtime API permits exactly one response at a time. A `response.create`
 * sent while one is already generating is REJECTED — error code
 * `conversation_already_has_active_response` — and it is not queued. Nothing
 * retries it.
 *
 * That matters here because the client's only way of making the agent ask the
 * next question is to send `response.create` after a tool call comes back. And
 * `response.function_call_arguments.done`, which is what tells us the tool was
 * called, is emitted *while the response that called it is still open*. If the
 * model paired a spoken line with the tool call — "got it, let me write that
 * down" — that response stays open for as long as the audio takes to generate.
 * An ordinary server round-trip then lands squarely inside it, the create is
 * rejected, and the turn dies: the answer is written, and the agent never asks
 * anything again until the seller prods it.
 *
 * So the client is not allowed to guess. It tracks the response lifecycle, and
 * this reducer decides when a create may go out:
 *
 *   - one create per turn, never one per tool call, however many the model made
 *   - never while a response is open; the want is held until `response.done`
 *   - a rejected create is remembered, not dropped
 *   - and if all of that somehow still leaves the seller in silence, a nudge
 *     re-sends. Never block the seller — least of all with nothing on screen.
 *
 * Pure: no React, no network, no timers. The point is that it can be replayed
 * event by event in a script.
 */

/** How long a wanted-but-unspoken reply may sit before the watchdog re-sends. */
export const NUDGE_AFTER_MS = 5_000;

export interface TurnState {
  /** A response is open — the agent is thinking or speaking right now. */
  readonly active: boolean;
  /**
   * How we came to believe a response is open.
   *
   * "created" is fact — the server said so. "guessed" is inference from a
   * rejection: something refused our create, so something else probably holds
   * the floor. That inference can be wrong, and when it is, no response.done
   * ever arrives to clear it.
   */
  readonly activeVia: "created" | "guessed" | null;
  /** Tool calls whose server round-trip has not come back yet. */
  readonly outstanding: readonly string[];
  /** We owe the seller a spoken reply and have not had one yet. */
  readonly wanted: boolean;
  /** When the last create went out, so the watchdog does not double-send. */
  readonly askedAt: number;
}

export type TurnEvent =
  /** The server opened a response. */
  | { type: "response.created" }
  /** The server closed it. */
  | { type: "response.done" }
  /** Our create bounced: something else was already speaking. */
  | { type: "response.rejected" }
  /** A tool call was handed to the server. */
  | { type: "tool.called"; callId: string }
  /** Its result came back and the output has been delivered to the model. */
  | { type: "tool.settled"; callId: string }
  /** Something other than a tool call means the agent should speak. */
  | { type: "reply.wanted" }
  /** Stand down — we are leaving the conversation, not waiting on it. */
  | { type: "reply.abandoned" }
  /** The watchdog ticked. */
  | { type: "nudge" };

export interface TurnStep {
  readonly state: TurnState;
  /** True means: send `{ type: "response.create" }` now. */
  readonly createResponse: boolean;
}

export const INITIAL_TURN: TurnState = {
  active: false,
  activeVia: null,
  outstanding: [],
  wanted: false,
  askedAt: 0,
};

const hold = (state: TurnState): TurnStep => ({ state, createResponse: false });

/**
 * `wanted` deliberately stays true through the create. It is cleared by
 * `response.created` — by the server confirming, not by us hoping.
 */
const ask = (state: TurnState, now: number): TurnStep => ({
  state: { ...state, wanted: true, askedAt: now },
  createResponse: true,
});

export function step(state: TurnState, event: TurnEvent, now = 0): TurnStep {
  switch (event.type) {
    case "response.created":
      return hold({ ...state, active: true, activeVia: "created", wanted: false });

    case "response.done": {
      const settled = { ...state, active: false, activeVia: null };
      return settled.wanted && settled.outstanding.length === 0
        ? ask(settled, now)
        : hold(settled);
    }

    case "response.rejected":
      // Whatever we tried to start, something else holds the floor. Keep the
      // want; response.done will release it.
      return hold({ ...state, active: true, activeVia: "guessed" });

    case "tool.called":
      return hold({ ...state, outstanding: [...state.outstanding, event.callId] });

    case "tool.settled": {
      if (!state.outstanding.includes(event.callId)) return hold(state);
      const outstanding = state.outstanding.filter((id) => id !== event.callId);
      const settled = { ...state, outstanding };
      // The model may have called several tools in one response. One reply
      // covers all of them, and it waits until the last one is back.
      if (outstanding.length > 0) return hold(settled);
      return settled.active ? hold({ ...settled, wanted: true }) : ask(settled, now);
    }

    case "reply.wanted":
      return state.active || state.outstanding.length > 0
        ? hold({ ...state, wanted: true })
        : ask(state, now);

    case "reply.abandoned":
      // Standing down has to include whatever is still in the air. The client
      // settles the handoff call and then abandons, but the model can make two
      // calls in one response — and the second one settling would re-raise the
      // want this just cleared, putting the agent back on the floor after the
      // seller has already been handed to the form.
      return hold({ ...state, wanted: false, outstanding: [] });

    case "nudge": {
      if (!state.wanted || state.outstanding.length > 0) return hold(state);
      if (now - state.askedAt < NUDGE_AFTER_MS) return hold(state);

      /*
       * A reply that is genuinely happening announced itself with
       * response.created, and must never be interrupted. A merely *guessed* one
       * did not — and if that guess was wrong, no response.done is coming, so
       * `active` pins true forever: the nudge can never fire and isPending() is
       * false, which is silence with not even a spinner. Past the nudge window
       * the guess has outlived its usefulness. Drop it and ask.
       */
      if (state.active && state.activeVia === "created") return hold(state);
      if (state.active) return ask({ ...state, active: false, activeVia: null }, now);
      return ask(state, now);
    }
  }
}

/**
 * Fold a whole event sequence. Used by the checks, and by nothing else.
 *
 * `creates` is the index of every event that sent a `response.create`, so a
 * check can assert not just how many went out but which event released them —
 * which is the entire point: the create has to wait for `response.done`.
 *
 * An entry may be `[event, now]` to place it on the clock.
 */
export function replay(
  events: ReadonlyArray<TurnEvent | readonly [TurnEvent, number]>,
  initial: TurnState = INITIAL_TURN,
): { state: TurnState; creates: number[] } {
  let state = initial;
  const creates: number[] = [];
  events.forEach((entry, index) => {
    const [event, now] = Array.isArray(entry)
      ? (entry as readonly [TurnEvent, number])
      : [entry as TurnEvent, 0];
    const result = step(state, event, now);
    state = result.state;
    if (result.createResponse) creates.push(index);
  });
  return { state, creates };
}

/**
 * What the seller should see. True while we are waiting on the server or on the
 * agent to start — but not while the agent is actually speaking, which is not
 * waiting.
 */
export function isPending(state: TurnState): boolean {
  return (
    state.outstanding.length > 0 ||
    (state.wanted && (!state.active || state.activeVia === "guessed"))
  );
}

/** The Realtime error that means "you sent a create too early". */
export function isActiveResponseClash(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null | undefined;
  const code = typeof e?.code === "string" ? e.code : "";
  const message = typeof e?.message === "string" ? e.message : "";
  return (
    code === "conversation_already_has_active_response" ||
    /already has an active response/i.test(message)
  );
}
