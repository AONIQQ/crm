# The Agent panel — read when touching the record sheet's Agent tab


`lib/agent-record.ts` maps a record kind to everything downstream: the header sent, the
claim minted, the field a conversation is filed under, the empty-thread questions.
`AgentConversation` holds only the handle (session id + cursor); the transcript is in
`AgentEvent` from the audit hook.

- **Load with `session.snapshot()`, never by hand** — one call returns the event
  prefix, the cursor, and a continuation token *iff* eve will accept another turn.
  Hand-rolling the stream produced every panel bug this thing has had.
- **The token is the authority on whether a message can be sent**, not our reading of
  the events.
- **`streamIndex: 0` on resume** — the saved index is where the last *reader* stopped.
- **Quiet for 90 seconds is over, not working** — restarted agents leave sessions with
  no closing boundary, which would lock the thread forever.
- **An unreachable agent is `offline`, not `working`** — fall back to the `AgentEvent`
  archive and keep the composer usable.
- **An ended thread gets a Start-a-new-conversation button, not a locked box**;
  `composerState()` keeps ended and working apart.
- **Nothing mounts until the list has loaded**, or a new session starts and remounts.
- **The landed thread is captured once** (`resolveThread`), or the first save swaps the
  open conversation out from under a live answer. It lives in `?thread=`.
- **`keepMounted` on the tab descriptor** (`detail-sheet.tsx`) — Radix drops an inactive
  tab, aborting the stream mid-answer.
- **`autoScroll` and nothing else**; `scrollAnchor` stops it following the bottom.
- **One `MessageScrollerItem` per message, not per part**; ids prefer `toolCallId`.
- **Scoped to the rep** — a session id in a body decides which row, never whose.

This lives in the API and is not a breach of rule one: listing history decides nothing.

