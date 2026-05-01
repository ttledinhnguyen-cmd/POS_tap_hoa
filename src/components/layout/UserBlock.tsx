import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronsUpDown, LogOut, Plus } from "lucide-react";
import { useAuthStore, useCurrentOrg } from "@/stores/auth";
import { cn } from "@/lib/utils";

interface Props {
  variant: "sidebar" | "menu";
}

/**
 * Trả về initial 1 chữ cho avatar.
 * Việt Nam name "Lê Đình Dũng" → từ cuối là "Dũng" → "D".
 * Nếu không có fullName, fallback chữ cái đầu của email. Nếu không có cả 2 → "?".
 */
function getInitial(fullName?: string | null, email?: string | null): string {
  if (fullName?.trim()) {
    const parts = fullName.trim().split(/\s+/);
    const last = parts[parts.length - 1];
    return last.charAt(0).toUpperCase();
  }
  if (email) return email.charAt(0).toUpperCase();
  return "?";
}

/**
 * UserBlock — Phase 3: wired vào useAuthStore.
 *
 * Variant:
 *   sidebar — full block trong Sidebar (avatar + tên + org + chevron)
 *   menu    — compact avatar trigger trong mobile Header (dropdown khi tap)
 *
 * Org switcher:
 *   - 1 org → render plain text, không dropdown (chỉ logout có sẵn)
 *   - >1 org → dropdown list, click item → switchOrg
 *   - + Tạo tiệm mới → /onboarding (cho phép owner tạo thêm org)
 */
export function UserBlock({ variant }: Props) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const user = useAuthStore((s) => s.user);
  const fullName = useAuthStore((s) => s.fullName);
  const memberships = useAuthStore((s) => s.memberships);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const switchOrg = useAuthStore((s) => s.switchOrg);
  const signOut = useAuthStore((s) => s.signOut);
  const currentOrg = useCurrentOrg();

  const initial = getInitial(fullName, user?.email);
  const displayName = fullName ?? user?.email ?? "—";
  const orgName = currentOrg?.name ?? "—";
  const hasMultipleOrgs = memberships.length > 1;

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
      setOpen(false);
    }
  };

  const handleSwitch = (orgId: string) => {
    switchOrg(orgId);
    setOpen(false);
  };

  const handleCreateOrg = () => {
    setOpen(false);
    navigate("/onboarding");
  };

  if (variant === "menu") {
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu người dùng"
          aria-expanded={open}
          className={cn(
            "w-9 h-9 rounded-full bg-primary-50 text-primary-700 font-semibold press",
            "flex items-center justify-center text-sm",
          )}
        >
          {initial}
        </button>
        {open && (
          <div
            className={cn(
              "absolute right-0 top-11 w-64 z-40 p-2",
              "bg-bg-card border border-line rounded-lg shadow-soft",
            )}
          >
            <UserBlockMenu
              displayName={displayName}
              orgName={orgName}
              memberships={memberships}
              currentOrgId={currentOrgId}
              hasMultipleOrgs={hasMultipleOrgs}
              onSwitch={handleSwitch}
              onCreateOrg={handleCreateOrg}
              onLogout={handleLogout}
            />
          </div>
        )}
      </div>
    );
  }

  // sidebar
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-3 px-2 py-2 rounded-lg press",
          "hover:bg-bg-subtle text-left min-h-[40px]",
        )}
      >
        <div
          className={cn(
            "w-9 h-9 rounded-full bg-primary-50 text-primary-700 font-semibold flex-shrink-0",
            "flex items-center justify-center text-sm",
          )}
        >
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          <p className="text-xs text-ink-muted truncate">{orgName}</p>
        </div>
        <ChevronsUpDown className="w-4 h-4 text-ink-subtle flex-shrink-0" />
      </button>
      {open && (
        <div
          className={cn(
            "absolute left-0 right-0 bottom-full mb-2 z-40 p-2",
            "bg-bg-card border border-line rounded-lg shadow-soft",
          )}
        >
          <UserBlockMenu
            displayName={displayName}
            orgName={orgName}
            memberships={memberships}
            currentOrgId={currentOrgId}
            hasMultipleOrgs={hasMultipleOrgs}
            onSwitch={handleSwitch}
            onCreateOrg={handleCreateOrg}
            onLogout={handleLogout}
          />
        </div>
      )}
    </div>
  );
}

interface MenuProps {
  displayName: string;
  orgName: string;
  memberships: ReturnType<typeof useAuthStore.getState>["memberships"];
  currentOrgId: string | null;
  hasMultipleOrgs: boolean;
  onSwitch: (orgId: string) => void;
  onCreateOrg: () => void;
  onLogout: () => void;
}

function UserBlockMenu({
  displayName,
  orgName,
  memberships,
  currentOrgId,
  hasMultipleOrgs,
  onSwitch,
  onCreateOrg,
  onLogout,
}: MenuProps) {
  return (
    <>
      <div className="px-3 py-2">
        <p className="text-sm font-medium truncate">{displayName}</p>
        <p className="text-xs text-ink-muted truncate">{orgName}</p>
      </div>
      <div className="border-t border-line my-1" />

      {hasMultipleOrgs && (
        <>
          <p className="px-3 pt-1 pb-1 text-[11px] uppercase tracking-wide text-ink-subtle">
            Tiệm
          </p>
          {memberships.map((m) => {
            const active = m.org_id === currentOrgId;
            return (
              <button
                key={m.org_id}
                type="button"
                onClick={() => onSwitch(m.org_id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left",
                  "hover:bg-bg-subtle min-h-[40px] press",
                )}
              >
                <span className="flex-1 truncate">{m.organization.name}</span>
                {active && <Check className="w-4 h-4 text-primary-700" />}
              </button>
            );
          })}
        </>
      )}

      <button
        type="button"
        onClick={onCreateOrg}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left",
          "hover:bg-bg-subtle min-h-[40px] press text-ink-muted",
        )}
      >
        <Plus className="w-4 h-4" />
        <span>Tạo tiệm mới</span>
      </button>

      <div className="border-t border-line my-1" />

      <button
        type="button"
        onClick={onLogout}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left",
          "hover:bg-bg-subtle min-h-[40px] press text-danger",
        )}
      >
        <LogOut className="w-4 h-4" />
        <span>Đăng xuất</span>
      </button>
    </>
  );
}
