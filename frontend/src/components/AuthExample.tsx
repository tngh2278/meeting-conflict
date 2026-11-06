// useAuth와 AuthDialog를 연결하는 방법을 보여주는 예시 컴포넌트
// App.tsx의 login/logout 부분을 어떻게 바꿔야 하는지 참고용으로 보여드립니다.
// (이 파일은 실제 사용하지 않아도 됩니다 — 코드만 참고하시면 됩니다)

import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import AuthDialog from "./AuthDialog";

export default function AuthExample() {
  const { user, loading, signUp, signIn, signOut } = useAuth();
  const [dialog, setDialog] = useState<"login" | "signup" | null>(null);

  if (loading) {
    return <div>세션 복원 중...</div>;
  }

  if (!user) {
    return (
      <>
        <button onClick={() => setDialog("login")}>로그인</button>
        <button onClick={() => setDialog("signup")}>회원가입</button>

        {dialog && (
          <AuthDialog
            mode={dialog}
            onMode={(m) => setDialog(m)}
            onClose={() => setDialog(null)}
            onSignUp={signUp}
            onSignIn={signIn}
          />
        )}
      </>
    );
  }

  return (
    <>
      <p>안녕하세요, {user.name}님!</p>
      <p>이메일: {user.email}</p>
      <button onClick={() => signOut()}>로그아웃</button>
    </>
  );
}
