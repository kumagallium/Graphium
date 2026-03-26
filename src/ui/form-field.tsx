// Crucible デザインシステム — FormField コンポーネント
// Label + Input/Textarea の組み合わせ。設定モーダル等のフォームに使用。

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// ラベル
type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;
const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label
      className={cn("text-xs font-semibold text-foreground block mb-1", className)}
      ref={ref}
      {...props}
    />
  ),
);
Label.displayName = "Label";

// テキスト入力
type InputProps = InputHTMLAttributes<HTMLInputElement>;
const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      className={cn(
        "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";

// テキストエリア
type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm min-h-[80px]",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

// FormField（Label + Input をまとめたショートカット）
type FormFieldProps = {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
};

function FormField({ label, htmlFor, children, className }: FormFieldProps) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export { Label, Input, Textarea, FormField };
