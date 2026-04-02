'use strict';

const { allowMethods, sendJson, sendError } = require('../_lib/http');
const { destroySession } = require('../_lib/auth');

module.exports = async (req, res) => {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    await destroySession(req, res);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
};
