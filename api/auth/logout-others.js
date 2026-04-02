'use strict';

const { allowMethods, sendJson, sendError } = require('../_lib/http');
const { requireUser, destroyOtherSessions } = require('../_lib/auth');

module.exports = async (req, res) => {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    const user = await requireUser(req);
    const revokedCount = await destroyOtherSessions(req, user.id);

    sendJson(res, 200, {
      ok: true,
      revokedCount
    });
  } catch (error) {
    sendError(res, error);
  }
};
