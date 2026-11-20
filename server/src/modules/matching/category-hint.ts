// B9: service category suggestion (proposal section 20, item 3). Suggests the
// main Uni Service category from the task text by keywords in English and
// Bangla. The user always chooses; this only pre-selects a hint.

export type CategoryCode =
  | "SHOPPING_PURCHASING"
  | "PARCEL_DELIVERY"
  | "PHARMACY_HEALTHCARE"
  | "DOCUMENT_ACADEMIC"
  | "WARRANTY_REPAIR"
  | "FINANCIAL_ADMINISTRATIVE";

const KEYWORDS: Record<CategoryCode, string[]> = {
  SHOPPING_PURCHASING: [
    "buy", "purchase", "shop", "shopping", "market", "grocery", "groceries", "mall", "store", "clothes", "book", "stationery", "gift",
    "কিনে", "কেনা", "কিনতে", "বাজার", "দোকান", "মার্কেট", "শপিং", "জামা", "উপহার", "বই",
  ],
  PARCEL_DELIVERY: [
    "parcel", "courier", "deliver", "delivery", "package", "pick up", "pickup", "drop", "send", "sundarban", "pathao",
    "পার্সেল", "কুরিয়ার", "ডেলিভারি", "প্যাকেট", "পৌঁছে", "পাঠাতে", "পাঠানো", "নিয়ে আসা",
  ],
  PHARMACY_HEALTHCARE: [
    "medicine", "pharmacy", "tablet", "syrup", "prescription", "drug", "inhaler", "bandage", "chemist", "hospital report",
    "ওষুধ", "ঔষধ", "ফার্মেসি", "প্রেসক্রিপশন", "ট্যাবলেট", "সিরাপ", "হাসপাতাল",
  ],
  DOCUMENT_ACADEMIC: [
    "print", "photocopy", "copy", "document", "assignment", "certificate", "transcript", "form", "submit", "registrar", "library", "binding", "scan",
    "প্রিন্ট", "ফটোকপি", "কাগজ", "এসাইনমেন্ট", "অ্যাসাইনমেন্ট", "সার্টিফিকেট", "ট্রান্সক্রিপ্ট", "ফর্ম", "জমা", "লাইব্রেরি", "বাইন্ডিং",
  ],
  WARRANTY_REPAIR: [
    "repair", "fix", "warranty", "service center", "servicing", "broken", "screen", "laptop", "phone", "charger", "battery",
    "মেরামত", "ঠিক করা", "ঠিক করতে", "ওয়ারেন্টি", "সার্ভিস সেন্টার", "নষ্ট", "ভাঙা", "ল্যাপটপ", "ফোন", "চার্জার",
  ],
  FINANCIAL_ADMINISTRATIVE: [
    "bill", "fee", "payment", "bank", "deposit", "tuition", "admission", "pay", "utility", "electricity", "challan", "office",
    "বিল", "ফি", "ব্যাংক", "জমা দিতে", "টিউশন", "ভর্তি", "পেমেন্ট", "চালান", "বিদ্যুৎ", "অফিস",
  ],
};

const normalise = (text: string) => ` ${text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim()} `;

// The best category and how sure the hint is (share of matched keywords), or
// null when nothing matches or two categories tie.
export function suggestServiceCategory(text: string): { code: CategoryCode; confidence: number } | null {
  const haystack = normalise(text);
  const scores = (Object.entries(KEYWORDS) as [CategoryCode, string[]][]).map(([code, words]) => ({
    code,
    hits: words.filter((word) => haystack.includes(` ${normalise(word).trim()}`)).length,
  }));
  const total = scores.reduce((sum, s) => sum + s.hits, 0);
  if (total === 0) return null;
  scores.sort((a, b) => b.hits - a.hits);
  if (scores[1] && scores[1].hits === scores[0]!.hits) return null;
  return { code: scores[0]!.code, confidence: Math.round((scores[0]!.hits / total) * 100) / 100 };
}
