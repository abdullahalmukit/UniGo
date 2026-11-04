import { api } from "../../lib/api";

export type StudentVerificationStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";

// GET /api/verification/student
export type StudentVerification = {
  status: StudentVerificationStatus;
  verifiedBy: "UNIVERSITY_EMAIL" | "ID_CARD" | null;
  universityEmail: string | null;
  idCard: {
    status: "PENDING" | "VERIFIED" | "REJECTED";
    submittedAt: string;
    reviewedAt: string | null;
    rejectionReason: string | null;
  } | null;
  // The code waiting to be entered, if any
  emailCode: { email: string; expiresAt: string; resendAvailableAt: string; attemptsLeft: number } | null;
};

export type SentCode = { email: string; expiresAt: string; resendAvailableAt: string };

export function getStudentVerification() {
  return api<StudentVerification>("/verification/student");
}

export function sendEmailCode(email: string) {
  return api<SentCode>("/verification/student/email/send", { method: "POST", body: { email } });
}

export function confirmEmailCode(code: string) {
  return api<StudentVerification>("/verification/student/email/confirm", { method: "POST", body: { code } });
}

export function uploadIdCard(file: File) {
  const body = new FormData();
  body.append("file", file);
  return api<StudentVerification>("/verification/student/id-card", { method: "POST", body });
}
