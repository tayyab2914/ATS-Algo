import type { PositionSide, SignalAction } from "@/lib/generated/prisma/enums";

/**
 * How a bot's TradingView alerts NAME their commands.
 *
 * The ATS indicator is normally wired through TradingView's "Any alert() function
 * call", which posts the indicator's own `alert()` message verbatim. The wording of
 * that message — which JSON key carries the command, and what word means "go long"
 * — is a setting inside the indicator, and the indicator now ships separate fields
 * for the long and the short payload. None of that is ours to dictate, so the
 * receiver is taught the vocabulary per bot instead of hardcoding one.
 *
 * Two rules make this safe to hand to an admin:
 *
 *  1. **A mapping only ever ADDS words.** The built-in vocabulary below is always
 *     accepted. Re-wording a bot therefore cannot silence an alert that already
 *     works — the worst an admin can do is fail to add a word, which shows up as a
 *     `signal.rejected` line naming the word that arrived.
 *  2. **A word means exactly one thing.** {@link signalMapError} refuses a mapping
 *     that points one word at two commands, because "is this a long or a short?"
 *     resolved by iteration order is a real-money coin flip.
 *
 * Pure and import-light on purpose: the receiver is on the hot path.
 */

/** The commands an alert can carry, in the order the admin panel lists them. */
export const SIGNAL_COMMANDS = [
  "enter_long",
  "enter_short",
  "exit",
  "tp1",
  "tp2",
  "tp3",
  "tp4",
  "tp5",
  "tp6",
  "tp7",
  "tp8",
  "tp9",
  "tp10",
] as const;

export type SignalCommand = (typeof SIGNAL_COMMANDS)[number];

/** What a command means to the engine: the stored action, and the side it implies. */
export type ResolvedCommand = { command: SignalCommand; action: SignalAction; side: PositionSide | null };

const MEANING: Record<SignalCommand, { action: SignalAction; side: PositionSide | null }> = {
  enter_long: { action: "ENTER", side: "LONG" },
  enter_short: { action: "ENTER", side: "SHORT" },
  exit: { action: "EXIT", side: null },
  tp1: { action: "TP1", side: null },
  tp2: { action: "TP2", side: null },
  tp3: { action: "TP3", side: null },
  tp4: { action: "TP4", side: null },
  tp5: { action: "TP5", side: null },
  tp6: { action: "TP6", side: null },
  tp7: { action: "TP7", side: null },
  tp8: { action: "TP8", side: null },
  tp9: { action: "TP9", side: null },
  tp10: { action: "TP10", side: null },
};

/** Human labels for the admin panel and for rejection messages. */
export const COMMAND_LABEL: Record<SignalCommand, string> = {
  enter_long: "Long entry",
  enter_short: "Short entry",
  exit: "Exit / stop-loss",
  tp1: "Take profit 1",
  tp2: "Take profit 2",
  tp3: "Take profit 3",
  tp4: "Take profit 4",
  tp5: "Take profit 5",
  tp6: "Take profit 6",
  tp7: "Take profit 7",
  tp8: "Take profit 8",
  tp9: "Take profit 9",
  tp10: "Take profit 10",
};

/** The JSON key the command sits under when a bot doesn't name another. */
export const DEFAULT_ACTION_FIELD = "action";

/**
 * Words every bot understands, always, on top of whatever is configured.
 *
 * `buy` / `sell` are here because the reference `signals/*.json` templates use them
 * and live alerts in the field still do.
 */
export const BUILT_IN_WORDS: Record<SignalCommand, string[]> = {
  enter_long: ["enter_long", "buy"],
  enter_short: ["enter_short", "sell"],
  exit: ["exit"],
  tp1: ["tp1"],
  tp2: ["tp2"],
  tp3: ["tp3"],
  tp4: ["tp4"],
  tp5: ["tp5"],
  tp6: ["tp6"],
  tp7: ["tp7"],
  tp8: ["tp8"],
  tp9: ["tp9"],
  tp10: ["tp10"],
};

/** A bot's stored vocabulary. Every field optional; `null` on the row means "built-ins only". */
export type SignalMap = {
  /** JSON key the command sits under. Defaults to {@link DEFAULT_ACTION_FIELD}. */
  field?: string;
  /** Extra words accepted for each command, ADDED to {@link BUILT_IN_WORDS}. */
  words?: Partial<Record<SignalCommand, string[]>>;
};

const isCommand = (v: string): v is SignalCommand => (SIGNAL_COMMANDS as readonly string[]).includes(v);

/** Comparison form for a word: an alert saying "Enter_Long " must match "enter_long". */
const norm = (word: string) => word.trim().toLowerCase();

/**
 * Read a stored `signalMap` back into a usable shape, discarding anything that
 * isn't the expected type.
 *
 * Defensive rather than trusting: this JSON reaches the money path, and a column
 * can be edited by hand, restored from a backup, or written by an older build.
 */
export function parseSignalMap(raw: unknown): SignalMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: SignalMap = {};

  if (typeof source.field === "string" && source.field.trim()) out.field = source.field.trim();

  const words = source.words;
  if (words && typeof words === "object" && !Array.isArray(words)) {
    const collected: Partial<Record<SignalCommand, string[]>> = {};
    for (const [key, value] of Object.entries(words as Record<string, unknown>)) {
      if (!isCommand(key) || !Array.isArray(value)) continue;
      const clean = value.filter((w): w is string => typeof w === "string" && w.trim() !== "").map((w) => w.trim());
      if (clean.length) collected[key] = clean;
    }
    if (Object.keys(collected).length) out.words = collected;
  }
  return out;
}

/** The full word list for one command: built-ins first, then the bot's own, deduped. */
export function wordsFor(map: SignalMap, command: SignalCommand): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of [...BUILT_IN_WORDS[command], ...(map.words?.[command] ?? [])]) {
    const key = norm(word);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(word);
    }
  }
  return out;
}

/** The JSON key this bot's alerts carry their command under. */
export const actionFieldOf = (map: SignalMap): string => map.field?.trim() || DEFAULT_ACTION_FIELD;

/**
 * Pull the command out of an alert body.
 *
 * Reads the bot's configured key, and falls back to the built-in `action` key when
 * that finds nothing — so pointing a bot at a new key never breaks the alerts it was
 * already receiving. Non-string values (a number, an object) are ignored rather than
 * coerced: `{"action": {"x": 1}}` is a broken template, not a command.
 */
export function readCommandWord(payload: Record<string, unknown>, map: SignalMap): string | null {
  const field = actionFieldOf(map);
  const primary = payload[field];
  if (typeof primary === "string" && primary.trim()) return primary.trim();
  if (field !== DEFAULT_ACTION_FIELD) {
    const fallback = payload[DEFAULT_ACTION_FIELD];
    if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  }
  return null;
}

/**
 * Which command a word means for this bot, or null if none.
 *
 * Deterministic by construction: {@link signalMapError} has already refused any
 * mapping in which a word could resolve two ways, so the first match is the only match.
 */
export function resolveCommand(word: string, map: SignalMap): ResolvedCommand | null {
  const needle = norm(word);
  if (!needle) return null;
  for (const command of SIGNAL_COMMANDS) {
    if (wordsFor(map, command).some((w) => norm(w) === needle)) {
      return { command, ...MEANING[command] };
    }
  }
  return null;
}

/** Every word this bot accepts, for the "unrecognised action" rejection message. */
export function acceptedWords(map: SignalMap): string[] {
  return SIGNAL_COMMANDS.flatMap((command) => wordsFor(map, command));
}

/**
 * The alert body to paste into the indicator for one command.
 *
 * The FIRST word is used — the built-in one unless the admin put their own ahead of
 * it — so what the panel tells you to paste is always something the receiver
 * accepts. Nothing in this string is substituted at send time: TradingView expands
 * neither the indicator's `{TIME}`/`{SIDE}`/`{PRICE}` nor its own documented
 * `{{close}}` inside a webhook body, and each of them has arrived here literally and
 * killed an entry.
 */
export function payloadFor(map: SignalMap, command: SignalCommand, secret: string): string {
  const word = map.words?.[command]?.[0] ?? BUILT_IN_WORDS[command][0];
  return JSON.stringify({ [actionFieldOf(map)]: word, secret });
}

/** A JSON key TradingView and this receiver can both carry without quoting games. */
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_WORDS_PER_COMMAND = 6;
const MAX_WORD_LENGTH = 40;

/**
 * Why a mapping can't be saved, or null when it's sound.
 *
 * The collision check is the one that matters: a word that resolves to both
 * `enter_long` and `enter_short` would decide a position's direction by iteration
 * order. `secret` is refused as a key for the obvious reason.
 */
export function signalMapError(map: SignalMap): string | null {
  const field = map.field?.trim();
  if (field !== undefined && field !== "") {
    if (!FIELD_RE.test(field)) {
      return `“${field}” isn't a usable JSON key — use letters, digits and underscores, starting with a letter or underscore.`;
    }
    if (field.toLowerCase() === "secret") {
      return "The command can't live under `secret` — that key carries the shared signal secret.";
    }
  }

  /** normalised word → the command that already claimed it. */
  const claimed = new Map<string, SignalCommand>();
  for (const command of SIGNAL_COMMANDS) {
    const custom = map.words?.[command] ?? [];
    if (custom.length > MAX_WORDS_PER_COMMAND) {
      return `${COMMAND_LABEL[command]}: at most ${MAX_WORDS_PER_COMMAND} words.`;
    }
    for (const word of custom) {
      const key = norm(word);
      if (!key) continue;
      if (word.length > MAX_WORD_LENGTH) return `${COMMAND_LABEL[command]}: “${word}” is too long (max ${MAX_WORD_LENGTH} characters).`;
      // An unsubstituted template is the single most common way an alert gets
      // rejected — refuse to bake one into the mapping as well.
      if (/^(\{\{?.+\}?\}|<.+>)$/.test(word)) {
        return `${COMMAND_LABEL[command]}: “${word}” looks like an unfilled placeholder. Paste the literal word the indicator sends.`;
      }
      const owner = claimed.get(key);
      if (owner && owner !== command) {
        return `“${word}” is mapped to both ${COMMAND_LABEL[owner]} and ${COMMAND_LABEL[command]}. One word has to mean one thing — an alert can't be a long and a short at once.`;
      }
      claimed.set(key, command);
    }
  }

  // A custom word that collides with a DIFFERENT command's built-in is the same
  // hazard: built-ins are always accepted, so the alert would still resolve to the
  // built-in's meaning and quietly do the opposite of what was configured.
  for (const command of SIGNAL_COMMANDS) {
    for (const word of map.words?.[command] ?? []) {
      const key = norm(word);
      for (const other of SIGNAL_COMMANDS) {
        if (other === command) continue;
        if (BUILT_IN_WORDS[other].some((builtIn) => norm(builtIn) === key)) {
          return `“${word}” already means ${COMMAND_LABEL[other]} on every bot, so it can't also mean ${COMMAND_LABEL[command]}. Pick a different word.`;
        }
      }
    }
  }

  return null;
}

/** Strip a mapping down to what's worth storing; `null` when it adds nothing to the built-ins. */
export function normalizeSignalMap(map: SignalMap): SignalMap | null {
  const out: SignalMap = {};
  const field = map.field?.trim();
  if (field && field !== DEFAULT_ACTION_FIELD) out.field = field;

  const words: Partial<Record<SignalCommand, string[]>> = {};
  for (const command of SIGNAL_COMMANDS) {
    const custom = (map.words?.[command] ?? []).map((w) => w.trim()).filter(Boolean);
    // Drop words that are already built in for this command — storing them would
    // just make the panel echo duplicates back at the admin.
    const extra = custom.filter((w) => !BUILT_IN_WORDS[command].some((builtIn) => norm(builtIn) === norm(w)));
    const deduped = [...new Map(extra.map((w) => [norm(w), w])).values()];
    if (deduped.length) words[command] = deduped;
  }
  if (Object.keys(words).length) out.words = words;

  return out.field || out.words ? out : null;
}
