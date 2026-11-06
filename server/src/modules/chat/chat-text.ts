import { rules } from "../../config/rules.js";
import { AppError } from "../../utils/app-error.js";

// Chat text is stored as plain text and the client always shows it as text,
// never as HTML, so markup is harmless and kept as typed ("<3" stays "<3").
// What is removed (B2b decision 6):
// - control characters except new line and tab;
// - invisible direction overrides and isolates (U+202A-U+202E,
//   U+2066-U+2069), which can make text look like something else;
// - zero-width characters used to hide or disguise text (U+200B, U+FEFF).
// Zero-width joiner and non-joiner are kept: Bangla script needs them.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const INVISIBLE = /[​‪-‮⁦-⁩﻿]/g;

export function sanitizeMessageText(input: unknown) {
  if (typeof input !== "string") throw emptyMessage();
  const text = input
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(INVISIBLE, "")
    // At most two empty lines in a row
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (text.length === 0) throw emptyMessage();
  if (text.length > rules.chat.messageMaxLength) {
    throw new AppError(400, "MESSAGE_TOO_LONG", `A message can have at most ${rules.chat.messageMaxLength} characters`, {
      data: { max: rules.chat.messageMaxLength },
    });
  }
  return text;
}

function emptyMessage() {
  return new AppError(400, "MESSAGE_EMPTY", "Write a message");
}
