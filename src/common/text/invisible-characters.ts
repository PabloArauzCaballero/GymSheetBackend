/**
 * Characters that render as nothing but still count as "content": format
 * characters (Unicode category Cf: zero-width space, BOM, bidi overrides and
 * isolates, soft hyphen, tags…) and the Hangul fillers and braille blank that
 * are letters/symbols for Unicode yet draw an empty cell. They let a text look
 * empty while passing a "non-blank" check, or flip its direction (U+202E).
 *
 * The zero-width joiner is the one Cf kept, and only inside an emoji sequence
 * (👨‍👩‍👧): there it glues the pictographs together; anywhere else it is noise.
 */
const INVISIBLE =
  /[^\P{Cf}‍]|(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}️])‍|‍(?!\p{Extended_Pictographic})|[ᅟᅠㅤﾠ⠀]/gu;

export function stripInvisibleCharacters(value: string): string {
  return value.replace(INVISIBLE, "");
}
