import { useState } from "react";
import Modal from "./Modal";

type Mode = "login" | "signup";

interface AuthDialogProps {
  mode: Mode;
  onMode: (mode: "login" | "signup") => void;
  onClose: () => void;
  onSignUp: (email: string, password: string, name: string) => Promise<{ error: string | null }>;
  onSignIn: (email: string, password: string) => Promise<{ error: string | null }>;
}

export default function AuthDialog({
  mode,
  onMode,
  onClose,
  onSignUp,
  onSignIn,
}: AuthDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setMessage("");

    if (mode === "signup") {
      if (!name.trim()) {
        setMessage("이름을 입력해 주세요.");
        return;
      }
      if (password !== repeat) {
        setMessage("비밀번호가 일치하지 않습니다.");
        return;
      }
      if (password.length < 6) {
        setMessage("비밀번호는 최소 6자 이상이어야 합니다.");
        return;
      }

      setBusy(true);
      const { error } = await onSignUp(email.trim(), password, name.trim());
      setBusy(false);

      if (error) {
        setMessage(error);
        return;
      }
      onClose();
      return;
    }

    setBusy(true);
    const { error } = await onSignIn(email.trim(), password);
    setBusy(false);

    if (error) {
      setMessage(error);
      return;
    }
    onClose();
  }

  return (
    <Modal
      title={mode === "login" ? "로그인" : "회원가입"}
      onClose={onClose}
    >
      <div className="stack">
        <p className="muted">회의의 기록을 팀의 다음 결정으로 연결하세요.</p>

        {mode === "signup" && (
          <label className="field">
            <span>이름</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="표시될 이름"
            />
          </label>
        )}

        <label className="field">
          <span>이메일</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </label>

        <label className="field">
          <span>비밀번호</span>
          <div className="password-field">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="최소 6자 이상"
            />
            <button
              type="button"
              className="text-button"
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? "숨김" : "보기"}
            </button>
          </div>
        </label>

        {mode === "signup" && (
          <label className="field">
            <span>비밀번호 확인</span>
            <input
              type={showPassword ? "text" : "password"}
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              placeholder="비밀번호 다시 입력"
            />
          </label>
        )}

        {message && (
          <p className="notice-message" role="status">
            {message}
          </p>
        )}

        <button
          type="button"
          className="button button-primary"
          disabled={busy}
          onClick={handleSubmit}
        >
          {busy ? "처리 중..." : mode === "login" ? "로그인" : "회원가입"}
        </button>

        <button
          type="button"
          className="text-button"
          onClick={() => {
            onMode(mode === "login" ? "signup" : "login");
            setMessage("");
          }}
        >
          {mode === "login"
            ? "계정이 없으신가요? 회원가입"
            : "이미 계정이 있나요? 로그인"}
        </button>

        <p className="small muted">
          가입 시 입력한 이메일로 인증 메일이 발송될 수 있습니다.
          Supabase 대시보드 → Authentication → Users에서 가입된 사용자를
          확인할 수 있습니다.
        </p>
      </div>
    </Modal>
  );
}