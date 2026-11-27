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

async function pngToJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    // 얼굴 대조에 쓰는 최대 해상도에 맞추고 투명 배경을 흰색으로 채운다.
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG 사진을 변환하지 못했습니다.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob?.type === "image/jpeg") resolve(blob);
        else reject(new Error("PNG 사진을 변환하지 못했습니다."));
      }, "image/jpeg", 0.92);
    });
  } finally {
    bitmap.close();
  }
}

export async function saveFaceReference(
  userId: string,
  file: File,
): Promise<string> {
  const photo = file.type === "image/png" ? await pngToJpeg(file) : file;
  const { error } = await bucket.upload(`${userId}/${fileName}`, photo, {
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
