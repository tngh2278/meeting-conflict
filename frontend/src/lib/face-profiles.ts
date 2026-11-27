import { supabase } from "./supabaseClient";

const bucket = supabase.storage.from("face-references");
const fileName = "reference.jpg";

async function signedReferenceUrl(userId: string): Promise<string> {
  const { data, error } = await bucket.createSignedUrl(
    `${userId}/${fileName}`,
    900,
  );
  if (error || !data?.signedUrl) {
    throw new Error("기준 사진을 열지 못했습니다.");
  }
  return data.signedUrl;
}

export async function loadFaceReference(userId: string): Promise<string> {
  const { data, error } = await bucket.list(userId, { search: fileName });
  if (error) throw error;

  return (data ?? []).some((file) => file.name === fileName)
    ? signedReferenceUrl(userId)
    : "";
}

export async function saveFaceReference(
  userId: string,
  file: File,
): Promise<string> {
  const { error } = await bucket.upload(`${userId}/${fileName}`, file, {
    contentType: "image/jpeg",
    cacheControl: "0",
    upsert: true,
  });
  if (error) throw error;
  return signedReferenceUrl(userId);
}

export async function deleteFaceReference(userId: string): Promise<void> {
  const { error } = await bucket.remove([`${userId}/${fileName}`]);
  if (error) throw error;
}
