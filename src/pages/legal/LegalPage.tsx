import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { TERMS_MD, PRIVACY_MD } from "./legal-content";

const SUPPORT_ZALO = import.meta.env.VITE_SUPPORT_ZALO ?? "0901234567";
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL ?? "support@example.com";
const BUSINESS_NAME =
  import.meta.env.VITE_BUSINESS_NAME ?? "POS Tạp Hóa Co.";

/** Replace placeholders trong markdown content. */
function renderContent(template: string): string {
  return template
    .replace(/\{\{SUPPORT_ZALO\}\}/g, SUPPORT_ZALO)
    .replace(/\{\{SUPPORT_EMAIL\}\}/g, SUPPORT_EMAIL)
    .replace(/\{\{BUSINESS_NAME\}\}/g, BUSINESS_NAME);
}

interface Props {
  kind: "terms" | "privacy";
}

/**
 * Render markdown legal page (ToS hoặc Privacy).
 * Public route — không cần auth.
 *
 * Cảnh báo: TEMPLATE GENERIC, founder phải consult luật sư trước launch.
 */
export function LegalPage({ kind }: Props) {
  const md = kind === "terms" ? TERMS_MD : PRIVACY_MD;
  return (
    <div className="min-h-dvh bg-bg flex flex-col">
      <header className="border-b border-line bg-bg-card px-4 md:px-6 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Link
          to="/"
          className="p-2 -ml-2 rounded text-ink-muted hover:bg-bg-subtle press"
          aria-label="Quay về trang chính"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-base md:text-lg font-semibold">
          {kind === "terms" ? "Điều khoản dịch vụ" : "Chính sách bảo mật"}
        </h1>
      </header>
      <main className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
        <article className="max-w-3xl mx-auto prose-legal text-ink">
          <ReactMarkdown>{renderContent(md)}</ReactMarkdown>
        </article>
        <div className="max-w-3xl mx-auto mt-8 pt-6 border-t border-line text-xs text-ink-muted text-center">
          {kind === "terms" ? (
            <>
              Xem thêm:{" "}
              <Link to="/privacy" className="text-primary-700 hover:underline">
                Chính sách bảo mật
              </Link>
            </>
          ) : (
            <>
              Xem thêm:{" "}
              <Link to="/terms" className="text-primary-700 hover:underline">
                Điều khoản dịch vụ
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export function TermsPage() {
  return <LegalPage kind="terms" />;
}

export function PrivacyPage() {
  return <LegalPage kind="privacy" />;
}
