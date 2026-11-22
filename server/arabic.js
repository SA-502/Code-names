// توحيد النص العربي لمقارنة التلميح بكلمات اللوحة
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g; // تشكيل + تطويل

export function normalizeArabic(input) {
  let s = String(input ?? '').trim().toLowerCase();
  s = s.replace(DIACRITICS, '');
  s = s.replace(/[أإآٱ]/g, 'ا')
       .replace(/ة/g, 'ه')
       .replace(/ى/g, 'ي')
       .replace(/ؤ/g, 'و')
       .replace(/ئ/g, 'ي');
  s = s.replace(/[^\p{L}\p{N}]+/gu, '');
  return s;
}

// الجذر التقريبي: حذف "ال" و"وال" و"بال" و"لل" في البداية
export function stripArticle(s) {
  for (const p of ['وال', 'بال', 'كال', 'فال', 'ال', 'لل']) {
    if (s.startsWith(p) && s.length - p.length >= 2) return s.slice(p.length);
  }
  return s;
}

export function coreForm(input) {
  return stripArticle(normalizeArabic(input));
}

// هل التلميح ممنوع لأنه يطابق كلمة في اللوحة أو يحتويها أو تحتويه؟
export function clueConflicts(clue, word) {
  const a = coreForm(clue);
  const b = coreForm(word);
  if (!a || !b) return false;
  if (a === b) return true;
  // منع الاشتقاق البسيط: كلمة اللوحة داخل التلميح أو العكس (لكلمات بطول 3+)
  if (b.length >= 3 && a.includes(b)) return true;
  if (a.length >= 3 && b.includes(a)) return true;
  return false;
}
