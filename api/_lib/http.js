'use strict';

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return req.body ? JSON.parse(req.body) : {};
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function getPathId(req) {
  const id = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return id || null;
}

function allowMethods(req, res, methods) {
  if (methods.includes(req.method)) {
    return true;
  }

  res.setHeader('Allow', methods.join(', '));
  sendJson(res, 405, {
    error: `Method ${req.method} is not allowed.`
  });
  return false;
}

function normalizeError(error) {
  if (error?.code === '23505') {
    return { status: 409, message: 'البيانات موجودة بالفعل.' };
  }

  if (error?.code === '22P02') {
    return { status: 400, message: 'البيانات المرسلة غير صالحة.' };
  }

  return {
    status: error?.status || 500,
    message: error?.message || 'حدث خطأ غير متوقع.'
  };
}

function sendError(res, error) {
  const normalized = normalizeError(error);
  sendJson(res, normalized.status, {
    error: normalized.message
  });
}

module.exports = {
  sendJson,
  readJson,
  getPathId,
  allowMethods,
  sendError
};
