'use strict';

const { ensureSchema } = require('../_lib/db');
const { allowMethods, sendJson, sendError } = require('../_lib/http');
const { getSessionUser, getUserCount } = require('../_lib/auth');

module.exports = async (req, res) => {
  if (!allowMethods(req, res, ['GET'])) {
    return;
  }

  try {
    await ensureSchema();

    const [count, user] = await Promise.all([
      getUserCount(),
      getSessionUser(req)
    ]);

    sendJson(res, 200, {
      backendAvailable: true,
      hasUsers: count > 0,
      user
    });
  } catch (error) {
    sendError(res, error);
  }
};
