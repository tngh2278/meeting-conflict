// Supabase 클라이언트 초기화
// 이 파일은 프로젝트 전역에서 단 하나만 존재해야 합니다.
// 다른 파일에서는 `import { supabase } from "@/lib/supabaseClient"`로 불러다 씁니다.

import { createClient } from "@supabase/supabase-js";

// Vite 환경변수는 반드시 VITE_ 접두어로 시작해야 합니다.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // .env.local 파일이 없거나 값이 비어있을 때 명확하게 알려줍니다.
  throw new Error(
    "Supabase 환경변수가 없습니다. frontend 폴더에 .env.local 파일을 만들고 " +
      "VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 값을 채워주세요. " +
      "값은 Supabase 대시보드 → Settings → API에서 확인할 수 있습니다.",
  );
}

// 브라우저 환경에서 세션을 자동으로 localStorage에 저장/복원하도록 설정합니다.
// 이렇게 하면 새로고침해도 로그인이 풀리지 않습니다.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
