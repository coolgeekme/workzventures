// Shared file-upload constraints for Listing Data Room, Vault, Private Locker.
// Backend extracts text from PDF / DOCX / XLSX / PPTX / TXT-family; other types
// are stored as-is (no auto-extraction).

export const UPLOAD_ACCEPT =
  ".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.pptx,.ppt,.txt,.md,.csv,.tsv,.json," +
  ".png,.jpg,.jpeg,.gif,.webp,.heic,.heif,.svg," +
  ".mp4,.mov,.webm,.mp3,.wav,.m4a,.zip";

export const UPLOAD_HINT =
  "PDF · DOCX · XLSX · PPTX · TXT/MD/CSV · images · video/audio · ZIP";

export const UPLOAD_MAX_MB = 50;
export const UPLOAD_MAX_BYTES = UPLOAD_MAX_MB * 1024 * 1024;
