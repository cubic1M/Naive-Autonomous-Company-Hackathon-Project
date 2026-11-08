"use client";

// Password field with a Show/Hide toggle inside it. Toggling keeps focus and the caret in the field,
// so people can check what they typed mid-word. Used everywhere a password is entered.
import { useState } from "react";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

export default function PasswordInput({ style, ...props }: Props) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", display: "flex", width: "100%" }}>
      <input
        {...props}
        type={show ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        style={{ ...style, width: "100%", boxSizing: "border-box", paddingRight: 72 }}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        style={{
          position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
          border: 0, background: "transparent", color: "#46664F", font: "inherit", fontSize: 14, fontWeight: 600,
          padding: "8px 10px", borderRadius: 8, cursor: "pointer", minHeight: 36,
        }}
      >
        {show ? "Hide" : "Show"}
      </button>
    </span>
  );
}
