/**
 * Key names as musicians write them in each language: letter names in
 * English, Japanese and Korean ("F♯ minor"), solfège in Spanish, French,
 * Portuguese and Russian ("Fa sostenido menor", "фа-диез минор"), German
 * names in German ("fis-Moll", "B-Dur" for B♭, "H" for B).
 */

import { type MusicalKey, tonicName } from '@/lib/key-bpm';
import { locale, t } from './i18n';

const LETTERS = 'CDEFGAB';

const GERMAN: Record<string, string> = {
  C: 'C',
  'C#': 'Cis',
  Db: 'Des',
  D: 'D',
  'D#': 'Dis',
  Eb: 'Es',
  E: 'E',
  F: 'F',
  'F#': 'Fis',
  Gb: 'Ges',
  G: 'G',
  'G#': 'Gis',
  Ab: 'As',
  A: 'A',
  'A#': 'Ais',
  Bb: 'B',
  B: 'H',
};

/** "F#", "Bb" (as key-bpm spells them) in this language. */
function localTonic(spelled: string) {
  if (locale.startsWith('de')) return GERMAN[spelled] ?? spelled;
  const names = t('noteNames').split(' ');
  const letter = spelled.charAt(0);
  const name = names[LETTERS.indexOf(letter)] ?? letter;
  const accidental = spelled.slice(1);
  if (accidental === '#') return t('sharpName', name);
  if (accidental === 'b') return t('flatName', name);
  return name;
}

/** "A minor" in this language; `like` keeps a relative key's spelling. */
export function keyLabel(key: MusicalKey, like?: MusicalKey) {
  let tonic = localTonic(tonicName(key, like));
  if (key.mode === 'minor' && t('minorLowercase') === 'yes') {
    tonic = tonic.toLowerCase();
  }
  return key.mode === 'major' ? t('keyMajor', tonic) : t('keyMinor', tonic);
}

/** "A minor", "Bb major": the same in every language (for CSV files). */
export function keyLabelEnglish(key: MusicalKey) {
  return `${tonicName(key)} ${key.mode}`;
}
