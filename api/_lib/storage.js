'use strict';

const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const defaultBucket = process.env.SUPABASE_STORAGE_BUCKET || 'ncr-attachments';

let adminClient;
let bucketPromise;

function isStorageEnabled() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

function getSupabaseAdmin() {
  if (!isStorageEnabled()) {
    return null;
  }

  if (!adminClient) {
    adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  return adminClient;
}

function sanitizeFilename(filename) {
  const parsed = path.parse(String(filename || 'attachment'));
  const base = (parsed.name || 'attachment')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'attachment';
  const ext = (parsed.ext || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  return `${base}${ext}`;
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    const error = new Error('صيغة المرفق غير صالحة للرفع.');
    error.status = 400;
    throw error;
  }

  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], 'base64')
  };
}

async function ensureBucket() {
  if (!isStorageEnabled()) {
    return false;
  }

  if (!bucketPromise) {
    bucketPromise = (async () => {
      const client = getSupabaseAdmin();
      const { data, error } = await client.storage.getBucket(defaultBucket);
      if (!error && data) {
        return true;
      }

      const { error: createError } = await client.storage.createBucket(defaultBucket, {
        public: false,
        fileSizeLimit: '52428800'
      });

      if (createError && !/already exists/i.test(createError.message || '')) {
        throw createError;
      }

      return true;
    })().catch(error => {
      bucketPromise = undefined;
      throw error;
    });
  }

  return bucketPromise;
}

function isSupabaseAttachment(attachment) {
  return Boolean(
    attachment &&
    attachment.storageProvider === 'supabase' &&
    attachment.path
  );
}

async function deleteAttachmentObject(attachment) {
  if (!isStorageEnabled() || !isSupabaseAttachment(attachment)) {
    return;
  }

  const client = getSupabaseAdmin();
  await client.storage.from(attachment.bucket || defaultBucket).remove([attachment.path]);
}

async function uploadAttachmentObject(caseId, attachment) {
  if (!attachment) {
    return null;
  }

  if (!isStorageEnabled()) {
    return attachment;
  }

  const inlineData = typeof attachment.base64 === 'string' && attachment.base64.startsWith('data:');
  if (!inlineData) {
    return {
      ...attachment,
      bucket: attachment.bucket || defaultBucket
    };
  }

  await ensureBucket();

  const { contentType, buffer } = parseDataUrl(attachment.base64);
  const safeName = sanitizeFilename(attachment.name);
  const objectPath = `cases/${caseId}/${Date.now()}-${safeName}`;
  const client = getSupabaseAdmin();

  const { error } = await client.storage
    .from(defaultBucket)
    .upload(objectPath, buffer, {
      contentType: attachment.type || contentType || 'application/octet-stream',
      upsert: false,
      cacheControl: '3600'
    });

  if (error) {
    throw error;
  }
  return {
    name: attachment.name || safeName,
    type: attachment.type || contentType || 'application/octet-stream',
    size: attachment.size || buffer.length,
    storageProvider: 'supabase',
    bucket: defaultBucket,
    path: objectPath
  };
}

async function resolveAttachmentObject(attachment) {
  if (!attachment) {
    return null;
  }

  if (!isStorageEnabled() || !isSupabaseAttachment(attachment)) {
    return attachment;
  }

  const client = getSupabaseAdmin();
  const { data, error } = await client.storage
    .from(attachment.bucket || defaultBucket)
    .createSignedUrl(attachment.path, 60 * 60);

  if (error) {
    return {
      ...attachment,
      url: null
    };
  }

  return {
    ...attachment,
    url: data.signedUrl
  };
}

async function resolveNcrAttachment(row) {
  if (!row) {
    return row;
  }

  return {
    ...row,
    attached_document: await resolveAttachmentObject(row.attached_document || null)
  };
}

async function resolveNcrAttachments(rows) {
  return Promise.all((rows || []).map(resolveNcrAttachment));
}

module.exports = {
  isStorageEnabled,
  uploadAttachmentObject,
  deleteAttachmentObject,
  resolveAttachmentObject,
  resolveNcrAttachment,
  resolveNcrAttachments
};
