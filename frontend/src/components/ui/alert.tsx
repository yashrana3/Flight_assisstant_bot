import * as React from "react";

type AlertVariant = "default" | "destructive";

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
}

export function Alert({
  className = "",
  variant = "default",
  ...props
}: AlertProps) {
  const base =
    "relative w-full rounded-lg border px-4 py-3 text-sm flex gap-3 items-start";
  const variantClasses =
    variant === "destructive"
      ? "bg-red-50 border-red-200 text-red-800"
      : "bg-white border-slate-200 text-slate-900";

  return (
    <div
      role="alert"
      className={`${base} ${variantClasses} ${className}`}
      {...props}
    />
  );
}

type AlertTitleProps = React.HTMLAttributes<HTMLDivElement>;

export function AlertTitle({ className = "", ...props }: AlertTitleProps) {
  return (
    <div
      className={`font-medium tracking-tight text-sm text-slate-900 ${className}`}
      {...props}
    />
  );
}

type AlertDescriptionProps = React.HTMLAttributes<HTMLDivElement>;

export function AlertDescription({
  className = "",
  ...props
}: AlertDescriptionProps) {
  return (
    <div
      className={`text-xs text-slate-600 leading-relaxed ${className}`}
      {...props}
    />
  );
}
