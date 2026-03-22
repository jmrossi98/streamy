import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.S3_BUCKET_NAME;
const REGION = process.env.S3_REGION || "us-east-1";

const VIDEO_EXTENSIONS = /\.(mp4|mkv|webm)$/i;
// Browser-native formats first; fallback to MKV (limited browser support)
const FORMAT_PRIORITY: Record<string, number> = { mp4: 0, webm: 1, mkv: 2 };
const PRESIGNED_EXPIRY_SECONDS = 6 * 60 * 60; // 6 hours

let _client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!BUCKET) return null;
  if (!_client) {
    _client = new S3Client({ region: REGION });
  }
  return _client;
}

/**
 * Find the first video file under `{titleId}/` in the configured S3 bucket
 * and return a pre-signed URL. Returns null if S3 isn't configured or no
 * video file exists for the given title.
 */
export async function getVideoUrl(
  titleId: string
): Promise<string | null> {
  const client = getClient();
  if (!client || !BUCKET) return null;

  try {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: `${titleId}/`,
        MaxKeys: 20,
      })
    );

    const videos = (list.Contents ?? [])
      .filter((obj) => obj.Key && VIDEO_EXTENSIONS.test(obj.Key))
      .sort((a, b) => {
        const extA = a.Key!.split(".").pop()!.toLowerCase();
        const extB = b.Key!.split(".").pop()!.toLowerCase();
        return (FORMAT_PRIORITY[extA] ?? 9) - (FORMAT_PRIORITY[extB] ?? 9);
      });

    const videoKey = videos[0]?.Key;

    if (!videoKey) return null;

    return await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: BUCKET, Key: videoKey }),
      { expiresIn: PRESIGNED_EXPIRY_SECONDS }
    );
  } catch (err) {
    console.error(`[s3] Failed to get video URL for title ${titleId}:`, err);
    return null;
  }
}
