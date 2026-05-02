import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  Building,
  Crown,
  ExternalLink,
  HelpCircle,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Printer,
  Store,
  UserCircle,
  Users,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase";
import { useAuthStore } from "@/stores/auth";
import { RoleGate } from "@/components/RoleGate";
import { Button } from "@/components/ui/Button";
import { OrgInfoForm } from "@/components/settings/OrgInfoForm";
import { ChangePasswordSheet } from "@/components/settings/ChangePasswordSheet";
import { cn } from "@/lib/utils";

const SUPPORT_ZALO = import.meta.env.VITE_SUPPORT_ZALO ?? "0901234567";
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL ?? "support@example.com";
const SUPPORT_BUSINESS_NAME =
  import.meta.env.VITE_BUSINESS_NAME ?? "POS Tạp Hóa Co.";
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "0.1.0";

interface Member {
  user_id: string;
  email: string;
  role: "owner" | "cashier";
  joined_at: string;
}

function formatJoinedDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const fullName = useAuthStore((s) => s.fullName);
  const orgId = useAuthStore((s) => s.currentOrgId);
  const signOut = useAuthStore((s) => s.signOut);
  const navigate = useNavigate();

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-6 py-4 border-b border-line bg-bg-card md:bg-bg">
        <h1 className="text-lg md:text-xl font-semibold">Cài đặt</h1>
        <p className="text-xs text-ink-muted">Tài khoản, tiệm và tích hợp</p>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 pb-24 md:pb-8">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          {/* E.1 Thông tin tiệm — owner only */}
          <RoleGate allow={["owner"]}>
            <Section icon={<Store className="w-5 h-5" />} title="Thông tin tiệm">
              <OrgInfoForm />
            </Section>
          </RoleGate>

          {/* E.2 Tài khoản — all roles */}
          <Section icon={<UserCircle className="w-5 h-5" />} title="Tài khoản">
            <div className="flex flex-col gap-3">
              <ReadOnlyField
                icon={<Mail className="w-4 h-4" />}
                label="Email"
                value={user?.email ?? "—"}
              />
              <ReadOnlyField
                icon={<UserCircle className="w-4 h-4" />}
                label="Họ tên"
                value={fullName ?? "—"}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowChangePassword(true)}
                className="self-start"
              >
                <KeyRound className="w-4 h-4" />
                Đổi mật khẩu
              </Button>
            </div>
          </Section>

          {/* E.3 Nhân viên — owner only */}
          <RoleGate allow={["owner"]}>
            <Section
              icon={<Users className="w-5 h-5" />}
              title="Quản lý nhân viên"
            >
              <MembersList orgId={orgId} />
              <div className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled
                  title="Chức năng đang phát triển"
                >
                  Thêm nhân viên
                </Button>
              </div>
            </Section>
          </RoleGate>

          {/* E.4 Thanh toán — owner only, placeholder */}
          <RoleGate allow={["owner"]}>
            <Section icon={<Wallet className="w-5 h-5" />} title="Thanh toán">
              <p className="text-sm font-medium">
                Cài đặt tài khoản nhận thanh toán không tiền mặt (VietQR + tự
                động xác nhận)
              </p>
              <p className="text-sm text-ink-muted mt-1.5">
                Chức năng đang được phát triển. Hiện tại app hỗ trợ thanh toán
                tiền mặt và chuyển khoản với xác nhận thủ công.
              </p>
            </Section>
          </RoleGate>

          {/* E.5 Máy in — owner only (lift restriction Sprint 5 khi cashier có thể re-pair) */}
          <RoleGate allow={["owner"]}>
            <Section icon={<Printer className="w-5 h-5" />} title="Máy in">
              <p className="text-sm font-medium">
                Kết nối máy in nhiệt 58mm qua Bluetooth hoặc USB
              </p>
              <p className="text-sm text-ink-muted mt-1.5">
                Hỗ trợ ở phiên bản tới (Sprint 5):
              </p>
              <ul className="text-sm text-ink-muted mt-1 space-y-1 list-disc pl-5">
                <li>
                  <span className="font-medium text-ink">Máy in Bluetooth:</span>{" "}
                  Xprinter XP-P200, RP58, GP-58 (không dây, có pin)
                </li>
                <li>
                  <span className="font-medium text-ink">Máy in USB:</span>{" "}
                  Xprinter XP-200, Star TSP100, Epson TM-T20 (cắm trực tiếp PC)
                </li>
              </ul>
              <p className="text-sm text-ink-muted mt-2">
                Hiện tại có thể xem hóa đơn trên màn hình.
              </p>
              <div className="mt-3">
                <Button type="button" variant="outline" disabled>
                  Pair máy in
                </Button>
              </div>
            </Section>
          </RoleGate>

          {/* E.6 Đăng xuất — all roles */}
          <Section icon={<LogOut className="w-5 h-5" />} title="Phiên đăng nhập">
            <p className="text-sm text-ink-muted mb-3">
              Đăng xuất khỏi thiết bị này. Dữ liệu của bạn vẫn được lưu trên máy chủ.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={handleLogout}
              loading={loggingOut}
              className="self-start"
            >
              <LogOut className="w-4 h-4" />
              {loggingOut ? "Đang đăng xuất..." : "Đăng xuất"}
            </Button>
          </Section>

          {/* E.7 Liên hệ hỗ trợ + ToS / Privacy + version */}
          <Section icon={<HelpCircle className="w-5 h-5" />} title="Hỗ trợ & Pháp lý">
            <div className="space-y-2 text-sm">
              <p className="text-ink-muted">
                {SUPPORT_BUSINESS_NAME} hỗ trợ qua Zalo và email
              </p>
              <a
                href={`https://zalo.me/${SUPPORT_ZALO}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-primary-700 hover:underline"
              >
                <span className="font-mono">{SUPPORT_ZALO}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="flex items-center gap-2 text-primary-700 hover:underline"
              >
                <span>{SUPPORT_EMAIL}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <div className="pt-3 border-t border-line/60 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <Link to="/terms" className="text-ink-muted hover:text-primary-700 hover:underline">
                  Điều khoản dịch vụ
                </Link>
                <Link to="/privacy" className="text-ink-muted hover:text-primary-700 hover:underline">
                  Chính sách bảo mật
                </Link>
                <span className="text-ink-subtle ml-auto">v{APP_VERSION}</span>
              </div>
            </div>
          </Section>
        </div>
      </div>

      <ChangePasswordSheet
        open={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
    </div>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

function Section({ icon, title, children }: SectionProps) {
  return (
    <section className="bg-bg-card border border-line rounded-lg p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-primary-700">{icon}</span>
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

interface ReadOnlyFieldProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function ReadOnlyField({ icon, label, value }: ReadOnlyFieldProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-ink-subtle flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-ink-muted">{label}</p>
        <p className="text-sm font-medium truncate">{value}</p>
      </div>
    </div>
  );
}

function MembersList({ orgId }: { orgId: string | null }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setMembers(null);
    setError(undefined);
    (async () => {
      const { data, error } = await supabase.rpc("get_org_members", {
        p_org_id: orgId,
      });
      if (cancelled) return;
      if (error) {
        setError(error.message);
        return;
      }
      setMembers((data ?? []) as Member[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!orgId) return null;
  if (error) {
    return <p className="text-sm text-danger">Lỗi tải danh sách: {error}</p>;
  }
  if (members === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Đang tải danh sách...
      </div>
    );
  }
  if (members.length === 0) {
    return <p className="text-sm text-ink-muted">Chưa có thành viên nào.</p>;
  }

  return (
    <ul className="bg-bg-subtle/50 rounded-lg divide-y divide-line">
      {members.map((m) => (
        <li
          key={m.user_id}
          className="flex items-center gap-3 px-3 py-2.5"
        >
          <span className="text-ink-subtle flex-shrink-0">
            {m.role === "owner" ? (
              <Crown className="w-4 h-4 text-accent" />
            ) : (
              <Building className="w-4 h-4" />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{m.email}</p>
            <p className="text-xs text-ink-muted">
              Tham gia {formatJoinedDate(m.joined_at)}
            </p>
          </div>
          <span
            className={cn(
              "px-2 py-0.5 rounded-full text-[11px] font-medium border",
              m.role === "owner"
                ? "bg-accent/10 text-accent border-accent/20"
                : "bg-bg-card text-ink-muted border-line",
            )}
          >
            {m.role === "owner" ? "Chủ tiệm" : "Thu ngân"}
          </span>
        </li>
      ))}
    </ul>
  );
}
