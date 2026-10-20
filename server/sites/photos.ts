// Site photo uploads to Supabase Storage. Server-side only: this is the one part
// of the app that uses SUPABASE_URL + SUPABASE_SERVICE_KEY. Talks to the Storage
// REST API directly, so there's no supabase-js dependency.

import { nanoid } from 'nanoid';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export type PhotoContentType = 'image/jpeg' | 'image/png' | 'image/webp';

const EXT: Record<PhotoContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Identify the image type from its magic bytes. The client-declared mimetype
 * isn't trusted: only real JPEG, PNG and WebP files pass.
 */
export function sniffImageType(buf: Buffer): PhotoContentType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function storageConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || '';
  const bucket = process.env.SITE_PHOTOS_BUCKET || 'site-photos';
  return { url, key, bucket };
}

export function isPhotoStorageConfigured(): boolean {
  const { url, key } = storageConfig();
  return Boolean(url && key);
}

/** Upload one image and return its public URL. The bucket must be public. */
export async function uploadSitePhoto(opts: {
  workspaceId: string;
  siteId: string;
  buffer: Buffer;
  contentType: PhotoContentType;
}): Promise<string> {
  const { url, key, bucket } = storageConfig();
  if (!url || !key) throw new Error('Photo storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY).');

  const path = `${opts.workspaceId}/${opts.siteId}/${nanoid(12)}.${EXT[opts.contentType]}`;
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': opts.contentType,
      'Cache-Control': 'max-age=31536000',
      'x-upsert': 'false',
    },
    body: new Uint8Array(opts.buffer),
  });
  if (!res.ok) {
    throw new Error(`Photo upload failed (${res.status}).`);
  }
  return `${url}/storage/v1/object/public/${bucket}/${path}`;
}
