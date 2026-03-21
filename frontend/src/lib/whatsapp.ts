export function normalizeWhatsAppPhone(value?: string | null) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return digits;
}

export function isValidWhatsAppPhone(value?: string | null) {
  const normalized = normalizeWhatsAppPhone(value);
  return normalized.length >= 12;
}

export function buildWhatsAppUrlWithText(phone: string, text: string) {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!isValidWhatsAppPhone(normalized)) return "";
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}
