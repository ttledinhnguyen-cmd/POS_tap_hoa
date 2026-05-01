import {
  cloneElement,
  type ReactElement,
  type ReactNode,
  useId,
} from "react";
import { cn } from "@/lib/utils";

interface InputLikeProps {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  className?: string;
}

interface Props {
  label: string;
  /**
   * Hint text dưới label, trên input. Optional.
   */
  hint?: string;
  /**
   * Error message dưới input. Khi có, set aria-invalid trên child input.
   */
  error?: string;
  /**
   * Phải là 1 input/select/textarea. FormField sẽ inject id + aria attrs.
   */
  children: ReactElement<InputLikeProps>;
  /**
   * Vietnamese hint cho field optional. Hiển thị "(không bắt buộc)" cuối label.
   */
  optional?: boolean;
  className?: string;
  /**
   * Slot phụ phía dưới error (vd. link "Quên mật khẩu?").
   */
  footer?: ReactNode;
}

/**
 * FormField — wrap label + input + error trong 1 block thống nhất.
 * Inject id, aria-invalid, aria-describedby vào child input.
 */
export function FormField({
  label,
  hint,
  error,
  children,
  optional,
  className,
  footer,
}: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(" ") || undefined;

  const child = cloneElement(children, {
    id,
    "aria-invalid": Boolean(error),
    "aria-describedby": describedBy,
    className: cn(
      "w-full px-3 rounded-lg border bg-bg-card text-ink placeholder:text-ink-subtle",
      "h-touch focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500",
      error
        ? "border-danger focus:ring-danger focus:border-danger"
        : "border-line",
      children.props.className,
    ),
  });

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {optional && (
          <span className="text-ink-subtle font-normal"> (không bắt buộc)</span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {child}
      {error && (
        <p id={errorId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {footer}
    </div>
  );
}
