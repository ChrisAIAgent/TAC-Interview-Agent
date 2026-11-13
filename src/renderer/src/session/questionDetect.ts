/** Rule-based detection for final ASR transcripts; no audio is processed here. */
const questionWords = ['什么', '怎么', '如何', '为什么', '哪些', '是否', '能不能', '有没有', '介绍一下', '说说', '讲讲', '谈谈', '描述一下', '举例'];
const confirmationPrefixes = ['嗯', '对', '好', '好的', '行'];

export function normalizeQuestion(text: string): string {
  return text.toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
}

function grams(text: string): Set<string> {
  const characters = Array.from(text);
  if (characters.length < 2) return new Set(characters);
  return new Set(characters.slice(0, -1).map((character, index) => character + characters[index + 1]));
}

/** Jaccard overlap of Unicode character bigrams. */
export function questionSimilarity(left: string, right: string): number {
  const a = grams(normalizeQuestion(left));
  const b = grams(normalizeQuestion(right));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const gram of a) if (b.has(gram)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

export type DetectionReason = 'question' | 'partial' | 'too_short' | 'confirmation' | 'no_question_marker' | 'duplicate';
export interface QuestionDetection { isQuestion: boolean; normalized: string; reason: DetectionReason }

/** recentQuestions is chronological; only its last five items are checked. */
export function detectQuestion(text: string, isFinal: boolean, recentQuestions: readonly string[] = []): QuestionDetection {
  const normalized = normalizeQuestion(text);
  const result = (reason: DetectionReason): QuestionDetection => ({ isQuestion: reason === 'question', normalized, reason });
  if (!isFinal) return result('partial');
  if (Array.from(normalized).length < 6) return result('too_short');
  if (confirmationPrefixes.some((prefix) => normalized.startsWith(prefix))) return result('confirmation');
  if (!/[?？]\s*$/u.test(text) && !questionWords.some((word) => text.includes(word))) return result('no_question_marker');
  if (recentQuestions.slice(-5).some((question) => questionSimilarity(text, question) > 0.85)) return result('duplicate');
  return result('question');
}
